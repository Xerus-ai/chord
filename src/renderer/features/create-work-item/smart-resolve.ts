import type { IssueRef, PullRequestRef } from '@shared/work-item-ticket';

/**
 * What the Smart field's text actually is.
 *
 * Parsing only — nothing here reaches the network. The dialog decides what to
 * fetch once it knows the shape, which keeps these rules testable and keeps a
 * typo from firing an API call.
 *
 * Typed text never means "reuse this existing branch": `main` and
 * `feat/auth-core` both name a new lane. Guessing a branch from a slash was
 * wrong both ways — a bare branch name never matched, and a slash name that
 * doesn't exist claimed to be reused. Reusing a branch is an explicit pick
 * from the repository's real branches (the Create from… picker), or a pasted
 * PR URL, which names exactly one branch.
 */
export type SmartFieldResolution =
  | {
      kind: 'github';
      owner: string;
      repo: string;
      number: number;
      type: 'issue' | 'pull';
      url: string;
    }
  | { kind: 'linear'; issueKey: string; url: string }
  | { kind: 'jira'; issueKey: string; url: string | null }
  | { kind: 'name'; name: string };

const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)/i;
const LINEAR_URL = /^https?:\/\/(?:www\.)?linear\.app\/[^/\s]+\/issue\/([A-Za-z0-9]+-\d+)/i;
const JIRA_URL = /^https?:\/\/[^/\s]+\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/i;
const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

export function resolveSmartField(input: string): SmartFieldResolution | null {
  const text = input.trim();
  if (!text) return null;

  const github = GITHUB_URL.exec(text);
  if (github) {
    return {
      kind: 'github',
      owner: github[1],
      repo: github[2],
      type: github[3].toLowerCase() === 'pull' ? 'pull' : 'issue',
      number: Number(github[4]),
      url: text,
    };
  }

  const linear = LINEAR_URL.exec(text);
  if (linear) return { kind: 'linear', issueKey: linear[1].toUpperCase(), url: text };

  const jiraUrl = JIRA_URL.exec(text);
  if (jiraUrl) return { kind: 'jira', issueKey: jiraUrl[1].toUpperCase(), url: text };

  if (JIRA_KEY.test(text)) return { kind: 'jira', issueKey: text, url: null };

  return { kind: 'name', name: text };
}

/**
 * The key a ticket is named by (`#123`, `ENG-42`) — the whole name when its
 * lookup fails, and the prefix of the name when it finds the title.
 */
export function provisionalName(resolution: SmartFieldResolution): string {
  switch (resolution.kind) {
    case 'github':
      return `#${resolution.number}`;
    case 'linear':
    case 'jira':
      return resolution.issueKey;
    case 'name':
      return resolution.name;
  }
}

/** The ticket to look up. A GitHub issue is read in the owner/repo its URL names. */
export function toIssueRef(resolution: SmartFieldResolution): IssueRef | null {
  switch (resolution.kind) {
    case 'github':
      return resolution.type === 'issue'
        ? {
            provider: 'github',
            owner: resolution.owner,
            repo: resolution.repo,
            number: resolution.number,
          }
        : null;
    case 'linear':
    case 'jira':
      return { provider: resolution.kind, key: resolution.issueKey };
    case 'name':
      return null;
  }
}

/** A pasted PR URL: an explicit pick of the PR's head branch, never a ticket. */
export function toPullRequestRef(resolution: SmartFieldResolution): PullRequestRef | null {
  if (resolution.kind !== 'github' || resolution.type !== 'pull') return null;
  return { owner: resolution.owner, repo: resolution.repo, number: resolution.number };
}
