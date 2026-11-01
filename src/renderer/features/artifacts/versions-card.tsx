import { X } from 'lucide-react';
import { displayName, formatRelativeTime } from './artifact-ui-utils';
import { EmptyState, PanelError } from './card-primitives';
import type { ArtifactVersion } from './use-versions';
import { describeVersionReason, groupVersionsByDay } from './version-history';

interface VersionsCardProps {
  /** Newest first. */
  versions: ArtifactVersion[];
  /** Why the history could not be read, when it could not be read. */
  error: string | null;
  /** The version on screen instead of the latest, if any. */
  previewVersion: ArtifactVersion | null;
  onPreview: (version: ArtifactVersion) => void;
  onBackToLatest: () => void;
  onClose: () => void;
}

/**
 * The Versions card (shared-items step 1, S7; design 2026-09-26 §3). It floats
 * at the content's top right: the history grouped by day, each version with
 * why it exists, who made it and when. A dot marks the current version.
 * Picking an older one shows it in place; the bar then offers Restore and
 * Back to latest.
 */
export function VersionsCard({
  versions,
  error,
  previewVersion,
  onPreview,
  onBackToLatest,
  onClose,
}: VersionsCardProps) {
  const current = versions[0];
  return (
    <div
      className="absolute right-3 top-3 z-30 flex max-h-[calc(100%-24px)] w-[300px] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-raised shadow-2xl"
      data-testid="versions-card"
    >
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="flex-1 text-body tracking-body font-semibold text-text">Versions</span>
        <button
          type="button"
          onClick={onClose}
          title="Close versions"
          className="rounded p-1 text-text-passive transition-colors hover:text-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-[100px] flex-1 flex-col overflow-y-auto p-1.5">
        {error ? (
          // A failed read must not look like an artifact that was never saved.
          <PanelError message={error} />
        ) : versions.length === 0 ? (
          <EmptyState
            title="No versions yet"
            body="Saving, publishing and agent updates each add one."
            icon={
              <>
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </>
            }
          />
        ) : (
          groupVersionsByDay(versions).map(({ day, versions: dayVersions }) => (
            <div key={day} className="flex flex-col">
              <div className="px-2 pb-1 pt-2 text-micro tracking-micro font-medium text-text-passive">
                {day}
              </div>
              {dayVersions.map((version) => {
                const isCurrent = version.id === current?.id;
                const isShown = previewVersion ? previewVersion.id === version.id : isCurrent;
                return (
                  <button
                    key={version.id}
                    type="button"
                    data-version={version.version_number}
                    aria-current={isShown}
                    onClick={() => (isCurrent ? onBackToLatest() : onPreview(version))}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      isShown ? 'bg-surface-inset' : 'hover:bg-surface-inset'
                    }`}
                  >
                    <span className="w-7 flex-shrink-0 text-tiny tracking-tiny font-semibold tabular-nums text-text">
                      v{version.version_number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-tiny tracking-tiny text-text-muted">
                      {describeVersionReason(version)} ·{' '}
                      {displayName(version.author_name ?? 'System')}
                    </span>
                    {isCurrent ? (
                      <span
                        title="Current version"
                        className="h-2 w-2 flex-shrink-0 rounded-full bg-status-ok-active"
                      />
                    ) : (
                      <span className="flex-shrink-0 text-micro tracking-micro tabular-nums text-text-passive">
                        {formatRelativeTime(version.created_at)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
