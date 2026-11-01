import { err, ok, type Result } from '@shared/result';
import type { IssueLookupError, WorkItemTicket } from '@shared/work-item-ticket';
import { requestJira, type JiraAuth } from './jira-http';
import type { RawJiraIssue } from './jira-issue-normalize';

/**
 * Reading one Jira issue by key has this one path. A missing issue is
 * `not_found` (Jira also answers 404 for an issue the user can't see);
 * rejected credentials are `not_connected`; anything else is `error`.
 */
export async function fetchJiraIssue(
  auth: JiraAuth,
  key: string,
  fields: readonly string[]
): Promise<Result<RawJiraIssue, IssueLookupError>> {
  const result = await requestJira(auth, `/rest/api/3/issue/${encodeURIComponent(key)}`, {
    query: { fields: fields.join(',') },
  });
  if (result.success) return ok(result.data as RawJiraIssue);

  const { status, message } = result.error;
  if (status === 404) return err({ type: 'not_found', message });
  if (status === 401) return err({ type: 'not_connected', message });
  return err({ type: 'error', message });
}

/** One Jira issue as a ticket linking back to the site. Null `auth` means not connected. */
export async function getJiraIssue(
  auth: JiraAuth | null,
  key: string
): Promise<Result<WorkItemTicket, IssueLookupError>> {
  if (!auth) return err({ type: 'not_connected', message: 'Jira is not connected.' });
  const issue = await fetchJiraIssue(auth, key, ['summary']);
  if (!issue.success) return issue;

  const resolvedKey = issue.data.key ?? key;
  return ok({
    provider: 'jira',
    id: resolvedKey,
    url: `${auth.siteUrl.replace(/\/+$/, '')}/browse/${resolvedKey}`,
    title: issue.data.fields?.summary ?? null,
  });
}
