import type { Issue } from '@shared/tasks';

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

export interface RawJiraIssue {
  id?: string;
  key?: string;
  fields?: {
    summary?: string;
    description?: AdfNode | null;
    updated?: string | null;
    project?: { key?: string; name?: string } | null;
    status?: { name?: string } | null;
    assignee?: { displayName?: string; name?: string } | null;
  };
}

/** The fields a listed or searched issue is read with. */
export const JIRA_ISSUE_FIELDS = [
  'summary',
  'description',
  'updated',
  'project',
  'status',
  'assignee',
] as const;

function flattenAdf(node: AdfNode | string | null | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (!Array.isArray(node.content)) return '';

  const parts = node.content.map((item) => flattenAdf(item));
  return ['doc', 'bulletList', 'orderedList'].includes(node.type ?? '')
    ? parts.join('\n')
    : parts.join('');
}

export function normalizeJiraIssues(siteUrl: string, rawIssues: RawJiraIssue[]): Issue[] {
  const base = siteUrl.replace(/\/+$/, '');
  return rawIssues.map((item) => {
    const fields = item.fields ?? {};
    return {
      provider: 'jira',
      identifier: String(item.key || ''),
      title: String(fields.summary || ''),
      url: `${base}/browse/${item.key}`,
      description: fields.description ? flattenAdf(fields.description) : undefined,
      status: fields.status?.name ?? undefined,
      assignees:
        fields.assignee?.displayName != null
          ? [fields.assignee.displayName ?? fields.assignee.name ?? ''].filter(Boolean)
          : undefined,
      project: fields.project?.name ?? undefined,
      updatedAt: fields.updated ?? undefined,
      fetchedAt: new Date().toISOString(),
    } satisfies Issue;
  });
}
