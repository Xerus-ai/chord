import type { ServerEventPayload } from '@chord/protocol';
import type { ArtifactRenderClass } from '@shared/artifact-render-class';
import { formatRelativeTime } from '../artifact-ui-utils';

export const NO_VIEW_MESSAGE = "The author hasn't published a viewable version yet";

/** `rpc.artifactPages.prepareCloud` data: the frame URL and the version it shows. */
export interface PreparedCloudPage {
  url: string;
  versionId: string;
  versionNumber: number;
  trigger: string;
  authorName: string | null;
  createdAt: string;
}

export type PrepareCloudResult =
  | { success: true; data: PreparedCloudPage }
  | { success: false; error: { type: string; message?: string } };

export type CloudPageState =
  | { kind: 'ready'; url: string; versionId: string; label: string }
  | { kind: 'no-view'; message: string }
  | { kind: 'error'; message: string };

/** "Version 4 · saved 5m ago by Ana" — the line over a cloud page. */
export function formatCloudVersionLabel(version: {
  versionNumber: number;
  createdAt: string;
  authorName: string | null;
}): string {
  const saved = `Version ${version.versionNumber} · saved ${formatRelativeTime(version.createdAt)}`;
  return version.authorName ? `${saved} by ${version.authorName}` : saved;
}

/**
 * What a cloud page tab shows for a prepareCloud outcome. `no_view` is an
 * empty state — the author has not uploaded a viewable version — not an error.
 */
export function describeCloudPageResult(result: PrepareCloudResult): CloudPageState {
  if (result.success) {
    return {
      kind: 'ready',
      url: result.data.url,
      versionId: result.data.versionId,
      label: formatCloudVersionLabel(result.data),
    };
  }
  if (result.error.type === 'no_view') return { kind: 'no-view', message: NO_VIEW_MESSAGE };
  return { kind: 'error', message: result.error.message ?? result.error.type };
}

/**
 * What an open cloud tab refreshes on `artifact_version_created`. The frame
 * reloads only when the new version has a view to show; a document's live
 * state arrives over Yjs, so only its history changes.
 */
export function planVersionEventRefresh(
  payload: ServerEventPayload<'artifact_version_created'>,
  tab: { artifactId: string; renderClass: ArtifactRenderClass }
): { refetchVersions: boolean; reloadFrame: boolean } {
  if (payload.artifact_id !== tab.artifactId) {
    return { refetchVersions: false, reloadFrame: false };
  }
  return { refetchVersions: true, reloadFrame: tab.renderClass === 'page' && payload.has_view };
}
