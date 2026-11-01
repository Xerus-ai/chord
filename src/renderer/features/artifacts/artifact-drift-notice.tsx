import { TriangleAlert } from 'lucide-react';
import type { ArtifactSourceDrift } from '@shared/artifact-source-drift';
import { FOCUS_RING } from '@renderer/lib/ui/focus-ring';
import { cn } from '@renderer/utils/utils';
import { useArtifactDriftActions, useArtifactSourceDrift } from './use-artifact-source-drift';

/**
 * "Out of date — N source files changed" for one artifact, with Update (asks
 * the agent) and Mark reviewed. Renders nothing while the artifact is current.
 * `bar` sits across the top of an open artifact; `inline` under a turn's card.
 * Hue is status only (`--status-warn`); the actions are chrome.
 */
export function ArtifactDriftNotice({
  workItemId,
  artifactId,
  fileName,
  layout,
}: {
  workItemId: string;
  artifactId: string;
  /** Named in the inline layout, where several artifacts can sit under one turn. */
  fileName?: string;
  layout: 'bar' | 'inline';
}) {
  const drift = useArtifactSourceDrift(workItemId, artifactId);
  if (!drift) return null;
  // Keyed by what changed: drift that clears and comes back starts with fresh actions.
  const signature = drift.changed.map((source) => `${source.change}:${source.path}`).join('|');
  return (
    <DriftNoticeContent
      key={signature}
      workItemId={workItemId}
      drift={drift}
      fileName={fileName}
      layout={layout}
    />
  );
}

function DriftNoticeContent({
  workItemId,
  drift,
  fileName,
  layout,
}: {
  workItemId: string;
  drift: ArtifactSourceDrift;
  fileName?: string;
  layout: 'bar' | 'inline';
}) {
  const { requestUpdate, markReviewed } = useArtifactDriftActions(workItemId);
  const count = drift.changed.length;
  const summary = `Out of date — ${count} source ${count === 1 ? 'file' : 'files'} changed`;
  const changedList = drift.changed
    .map((source) => `${source.path}${source.change === 'deleted' ? ' (deleted)' : ''}`)
    .join('\n');
  const error = requestUpdate.error ?? markReviewed.error;
  const busy = requestUpdate.isPending || markReviewed.isPending;

  return (
    <div
      data-artifact-drift={drift.artifactId}
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-2 text-tiny tracking-tiny text-text-muted',
        layout === 'bar'
          ? 'flex-shrink-0 border-b border-border-subtle bg-surface-inset px-4 py-2'
          : 'mt-1.5'
      )}
    >
      <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 text-status-warn" />
      <span className="min-w-0 truncate" title={changedList}>
        {fileName && <span className="font-semibold text-text">{fileName} · </span>}
        <span className="text-status-warn">{summary}</span>
      </span>
      <button
        type="button"
        disabled={busy || requestUpdate.isSuccess}
        onClick={() => requestUpdate.mutate(drift)}
        className={cn(
          'inline-flex h-[24px] flex-shrink-0 cursor-pointer items-center rounded-md border-none bg-action-bg px-2 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover disabled:cursor-default disabled:opacity-70',
          FOCUS_RING
        )}
      >
        {requestUpdate.isSuccess ? 'Asked the agent' : 'Update'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => markReviewed.mutate(drift.artifactId)}
        className={cn(
          'inline-flex h-[24px] flex-shrink-0 cursor-pointer items-center rounded-md border border-border bg-surface px-2 text-tiny tracking-tiny text-text transition-colors hover:border-border-strong disabled:cursor-default disabled:text-text-muted',
          FOCUS_RING
        )}
      >
        Mark reviewed
      </button>
      {error && <span className="w-full text-status-err">{error.message}</span>}
    </div>
  );
}
