import type { AgentTurn } from '@shared/stream-items';

type TurnItem = AgentTurn['items'][number];
export type TurnArtifact = TurnItem & { kind: 'artifact' };
export type UnpublishedDocument = Extract<
  TurnItem,
  { kind: 'unpublished_documents' }
>['files'][number];

/** The documents the agent wrote in this turn without publishing them. */
export function collectUnpublishedDocuments(items: TurnItem[]): UnpublishedDocument[] {
  return items.flatMap((item) => (item.kind === 'unpublished_documents' ? item.files : []));
}

/**
 * Splits a turn into the body it renders inline and the artifacts its footer
 * lists. Artifacts are transparent to prose — the same rule the main process
 * applies while streaming (agent-event-bridge `textItemToContinue`) — so text
 * runs an older persisted turn split around a card are rejoined, and a table
 * the card interrupted renders as one table again.
 */
export function partitionTurnItems(items: TurnItem[]): {
  body: TurnItem[];
  artifacts: TurnArtifact[];
} {
  const body: TurnItem[] = [];
  const artifacts: TurnArtifact[] = [];
  const seenArtifactIds = new Set<string>();
  let pendingText: (TurnItem & { kind: 'text' }) | null = null;

  for (const item of items) {
    if (item.kind === 'artifact') {
      if (!seenArtifactIds.has(item.artifactId)) {
        seenArtifactIds.add(item.artifactId);
        artifacts.push(item);
      }
      continue;
    }
    if (item.kind === 'text') {
      if (pendingText) {
        pendingText.text += item.text;
      } else {
        pendingText = { ...item };
        body.push(pendingText);
      }
      continue;
    }
    pendingText = null;
    body.push(item);
  }

  return { body, artifacts };
}

/**
 * A document chip's identity: a dimmed workspace-relative directory and the
 * file name. Paths outside the workspace (or with no known root) show the name
 * only — an absolute path from the owner's machine means nothing to a reader.
 */
export function describeArtifactPath(
  filePath: string,
  workspaceRoot: string | null
): { directory: string; fileName: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  if (!workspaceRoot) return { directory: '', fileName };

  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const caseInsensitive = /^[a-z]:/i.test(root);
  const pathForCompare = caseInsensitive ? normalized.toLowerCase() : normalized;
  const rootForCompare = caseInsensitive ? root.toLowerCase() : root;
  if (!pathForCompare.startsWith(`${rootForCompare}/`)) return { directory: '', fileName };

  const relative = normalized.slice(root.length + 1);
  const relSlash = relative.lastIndexOf('/');
  return { directory: relSlash >= 0 ? relative.slice(0, relSlash + 1) : '', fileName };
}
