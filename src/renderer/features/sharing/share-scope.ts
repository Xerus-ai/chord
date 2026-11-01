/** What the Share dialog shares: the whole work item, or one of its artifacts. */
export type ShareScope =
  | { kind: 'work_item' }
  | { kind: 'artifact'; artifactId: string; name: string };

export interface ShareScopeOption {
  /** 'work_item', or an artifact id. */
  value: string;
  label: string;
}

/**
 * The Share dialog's "What" (shared-items design §5): the whole work item or
 * one of its artifacts, with the artifact tab the owner is looking at
 * preselected.
 */
export function shareScopeOptions(
  artifacts: Array<{ id: string; name: string }>,
  activeArtifactId: string | null
): { options: ShareScopeOption[]; initial: ShareScope } {
  const options: ShareScopeOption[] = [
    { value: 'work_item', label: 'Whole work item' },
    ...artifacts.map((artifact) => ({ value: artifact.id, label: artifact.name })),
  ];
  if (activeArtifactId === null) return { options, initial: { kind: 'work_item' } };
  return { options, initial: scopeFor(artifacts, activeArtifactId) };
}

/** The scope an option value names. */
export function scopeFor(
  artifacts: Array<{ id: string; name: string }>,
  value: string
): ShareScope {
  if (value === 'work_item') return { kind: 'work_item' };
  const artifact = artifacts.find((candidate) => candidate.id === value);
  if (!artifact) throw new Error(`No artifact ${value} in this work item to share`);
  return { kind: 'artifact', artifactId: artifact.id, name: artifact.name };
}

/**
 * The link Copy link copies (design §5, amended 2026-09-27): the server's
 * https handoff (`web/open-routes.ts`), which opens it in Chord for people
 * with access and, unlike a raw `chord://` link, is clickable in chat and mail.
 */
export function shareLinkUrl(serverUrl: string, workItemId: string, scope: ShareScope): string {
  const base = serverUrl.replace(/\/+$/, '');
  return scope.kind === 'artifact'
    ? `${base}/open/artifact/${scope.artifactId}`
    : `${base}/open/work-item/${workItemId}`;
}
