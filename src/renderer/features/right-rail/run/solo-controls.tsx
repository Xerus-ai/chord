import type { SoloActionError, SoloView } from '@shared/solo';
import { Button } from '@renderer/lib/ui/button';
import {
  describeSoloError,
  describeSoloTab,
  SOLO_COMPOSE_HELP,
  type SoloTabModel,
} from './solo-model';

/**
 * The Run tab's Solo controls (plan §"Decisions for Phase 4", Run tab): the
 * slot's status from this lane's side and its one action ("Solo this
 * branch", "Queue (n ahead)", "Leave queue", Restore); while this lane holds
 * the root, Sync from lane and Release; a refusal in the panel itself with
 * its files, and "Discard and release" only as the explicit second step
 * after a root changed during Solo.
 */
export function SoloControls({
  solo,
  laneId,
  error,
  pending,
  onSolo,
  onLeaveQueue,
  onSync,
  onRelease,
}: {
  solo: SoloView;
  laneId: string;
  /** Why the last Solo action did not go through; null when it did. */
  error: SoloActionError | null;
  /** A Solo action is on its way. */
  pending: boolean;
  onSolo: () => void;
  onLeaveQueue: () => void;
  onSync: () => void;
  onRelease: (discardRootChanges: boolean) => void;
}) {
  const model = describeSoloTab(solo, laneId);
  const runAction = (kind: NonNullable<SoloTabModel['action']>['kind']) => {
    if (kind === 'leave') onLeaveQueue();
    else if (kind === 'restore') onRelease(false);
    else onSolo();
  };

  return (
    <div role="group" aria-label="Solo" className="flex flex-col gap-1.5 px-3 py-2">
      {model.status && <span className="break-all text-list-row text-text">{model.status}</span>}
      {model.files.length > 0 && <FileList files={model.files} />}
      <div className="flex flex-wrap items-center gap-1">
        {model.action && (
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={() => runAction(model.action!.kind)}
          >
            {model.action.label}
          </Button>
        )}
        {model.holding && (
          <>
            <Button variant="ghost" size="xs" disabled={pending} onClick={onSync}>
              Sync from lane
            </Button>
            <Button variant="outline" size="xs" disabled={pending} onClick={() => onRelease(false)}>
              Release
            </Button>
          </>
        )}
      </div>
      {error && (
        <SoloRefusal
          error={error}
          rootPath={solo.rootPath}
          pending={pending}
          onDiscard={() => onRelease(true)}
        />
      )}
      <ComposeHelp />
    </div>
  );
}

function SoloRefusal({
  error,
  rootPath,
  pending,
  onDiscard,
}: {
  error: SoloActionError;
  rootPath: string;
  pending: boolean;
  onDiscard: () => void;
}) {
  const refusal = describeSoloError(error, rootPath);
  return (
    <div role="alert" className="flex flex-col gap-1">
      <p className="break-all text-tiny tracking-tiny text-status-err">{refusal.message}</p>
      {refusal.files.length > 0 && <FileList files={refusal.files} />}
      {refusal.offerDiscard && (
        <Button
          variant="destructive"
          size="xs"
          className="self-start"
          disabled={pending}
          onClick={onDiscard}
        >
          Discard and release
        </Button>
      )}
    </div>
  );
}

function FileList({ files }: { files: string[] }) {
  return (
    <ul className="flex flex-col font-mono text-list-meta text-text-muted">
      {files.map((file) => (
        <li key={file} className="truncate">
          {file}
        </li>
      ))}
    </ul>
  );
}

/** The help line, with its command set as code. */
function ComposeHelp() {
  const parts = SOLO_COMPOSE_HELP.split('`');
  return (
    <p className="text-list-meta text-text-passive">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code key={part} className="font-mono text-text-muted">
            {part}
          </code>
        ) : (
          part
        )
      )}
    </p>
  );
}
