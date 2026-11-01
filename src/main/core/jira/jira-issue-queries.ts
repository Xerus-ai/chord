import type { IssueListResult } from '@shared/issue-providers';
import { err, ok, type Result } from '@shared/result';
import { normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import { requestJira, type JiraAuth } from './jira-http';
import { fetchJiraIssue } from './jira-issue-lookup';
import { JIRA_ISSUE_FIELDS, normalizeJiraIssues, type RawJiraIssue } from './jira-issue-normalize';

const LIST_JQL_CANDIDATES = [
  'assignee = currentUser() ORDER BY updated DESC',
  'reporter = currentUser() ORDER BY updated DESC',
  'ORDER BY updated DESC',
];

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** Project keys per site, read once for numeric searches. */
const projectKeysBySite = new Map<string, string[]>();

/**
 * JQL search. `POST /rest/api/3/search` is gone from Jira Cloud (410,
 * CHANGE-2046); `/search/jql` is its replacement.
 */
async function searchJql(
  auth: JiraAuth,
  jql: string,
  limit: number
): Promise<Result<RawJiraIssue[], string>> {
  const result = await requestJira(auth, '/rest/api/3/search/jql', {
    method: 'POST',
    body: { jql, maxResults: Math.min(Math.max(limit, 1), 100), fields: JIRA_ISSUE_FIELDS },
  });
  if (!result.success) return err(result.error.message);
  const issues = (result.data as { issues?: RawJiraIssue[] } | null)?.issues;
  return ok(Array.isArray(issues) ? issues : []);
}

async function readRecentIssueKeys(
  auth: JiraAuth,
  limit: number
): Promise<Result<string[], string>> {
  const result = await requestJira(auth, '/rest/api/3/issue/picker', {
    query: { query: '', currentJQL: '' },
  });
  if (!result.success) return err(result.error.message);

  const sections =
    (result.data as { sections?: Array<{ issues?: Array<{ key?: string }> }> } | null)?.sections ??
    [];
  const keys: string[] = [];
  for (const issue of sections.flatMap((section) => section.issues ?? [])) {
    const key = String(issue.key || '').trim();
    if (key && !keys.includes(key)) keys.push(key);
    if (keys.length >= limit) break;
  }
  return ok(keys);
}

async function readProjectKeys(auth: JiraAuth): Promise<Result<string[], string>> {
  const cached = projectKeysBySite.get(auth.siteUrl);
  if (cached) return ok(cached);
  const result = await requestJira(auth, '/rest/api/3/project');
  if (!result.success) return err(result.error.message);
  const projects = Array.isArray(result.data) ? (result.data as Array<{ key?: string }>) : [];
  const keys = projects.map((project) => String(project.key || '')).filter(Boolean);
  projectKeysBySite.set(auth.siteUrl, keys);
  return ok(keys);
}

/**
 * The user's issues: the first JQL candidate that finds any, else the issue
 * picker's recent keys read one by one. An empty search moves on; a failed
 * one fails the list. A recent key deleted before it was read is skipped;
 * any other failure fails the list.
 */
export async function listJiraIssues(auth: JiraAuth, limit: number): Promise<IssueListResult> {
  for (const jql of LIST_JQL_CANDIDATES) {
    const found = await searchJql(auth, jql, limit);
    if (!found.success) return { success: false, error: found.error };
    if (found.data.length > 0) {
      return { success: true, issues: normalizeJiraIssues(auth.siteUrl, found.data) };
    }
  }

  const keys = await readRecentIssueKeys(auth, limit);
  if (!keys.success) return { success: false, error: keys.error };

  const issues: RawJiraIssue[] = [];
  for (const key of keys.data) {
    const issue = await fetchJiraIssue(auth, key, JIRA_ISSUE_FIELDS);
    if (issue.success) issues.push(issue.data);
    else if (issue.error.type !== 'not_found')
      return { success: false, error: issue.error.message };
  }
  return { success: true, issues: normalizeJiraIssues(auth.siteUrl, issues) };
}

/**
 * A key-shaped term is read as that issue; one that is no issue is still
 * search text and falls through to JQL. Any other failure is returned. A
 * numeric term also matches that number in every project.
 */
export async function searchJiraIssues(
  auth: JiraAuth,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return { success: true, issues: [] };

  const looksLikeKey = ISSUE_KEY.test(term);
  if (looksLikeKey) {
    const issue = await fetchJiraIssue(auth, term.toUpperCase(), JIRA_ISSUE_FIELDS);
    if (issue.success) {
      return { success: true, issues: normalizeJiraIssues(auth.siteUrl, [issue.data]) };
    }
    if (issue.error.type !== 'not_found') return { success: false, error: issue.error.message };
  }

  const sanitized = term.replace(/"/g, '\\"');
  const keyClause = looksLikeKey ? ` OR issueKey = ${term.toUpperCase()}` : '';
  let numberClause = '';
  if (/^\d+$/.test(term)) {
    const projectKeys = await readProjectKeys(auth);
    if (!projectKeys.success) return { success: false, error: projectKeys.error };
    if (projectKeys.data.length > 0) {
      numberClause = ` OR key IN (${projectKeys.data.map((key) => `"${key}-${term}"`).join(',')})`;
    }
  }

  const found = await searchJql(auth, `text ~ "${sanitized}"${keyClause}${numberClause}`, limit);
  if (!found.success) return { success: false, error: found.error };
  return { success: true, issues: normalizeJiraIssues(auth.siteUrl, found.data) };
}
