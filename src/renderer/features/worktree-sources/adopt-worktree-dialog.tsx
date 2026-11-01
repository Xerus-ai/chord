import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { describeSessionImportError, type ImportableSession } from '@shared/session-import';
import {
  describeAdoptWorktreeError,
  pickAdoptionName,
  type AdoptWorktreeError,
  type DiscoveredWorktree,
} from '@shared/worktree-sources';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { RelativeTime } from '@renderer/lib/ui/relative-time';

/** The adopted work item, and the imported chat to open (the first ticked one). */
export interface AdoptDialogResult {
  workItemId: string;
  sessionId: string | null;
}

const providerName = (providerId: AgentProviderId) => getProvider(providerId)?.name ?? providerId;
const sessionKey = (session: ImportableSession) =>
  `${session.providerId}:${session.providerSessionId}`;

function SessionRow({
  session,
  ticked,
  onToggle,
}: {
  session: ImportableSession;
  ticked: boolean;
  onToggle: () => void;
}) {
  const title = session.title ?? `${providerName(session.providerId)} session`;
  return (
    <label
      data-adopt-session={session.providerSessionId}
      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-hover"
    >
      <input type="checkbox" checked={ticked} onChange={onToggle} />
      <span className="min-w-0 flex-1 truncate text-body tracking-body text-text" title={title}>
        {title}
      </span>
      <span className="shrink-0 text-tiny tracking-tiny text-text-passive">
        {providerName(session.providerId)}
        {session.lastActivityAt !== null && (
          <>
            {' · '}
            <RelativeTime value={session.lastActivityAt} compact />
          </>
        )}
      </span>
    </label>
  );
}

/**
 * Adopt a checkout Chord did not make (plan §Phase 3 slice 6): an editable
 * name — the newest found session's title, else the branch — and the agent
 * sessions found in the folder, ticked, to import with their history. The
 * folder stays the user's: Chord never changes it. A `stale_lane` refusal
 * offers "Point lane at this folder".
 */
export function AdoptWorktreeDialog({
  repoId,
  worktree,
  onSuccess,
  onClose,
}: BaseModalProps<AdoptDialogResult> & { repoId: string; worktree: DiscoveredWorktree }) {
  const found = useQuery({
    queryKey: ['worktreeSources', 'folderSessions', worktree.path],
    queryFn: async () => {
      const result = await rpc.worktreeSources.listFolderSessions(worktree.path);
      if (!result.success) throw new Error('Could not list the folder’s sessions');
      return result.data;
    },
  });
  const sessions = found.data?.lanes[0]?.sessions ?? [];
  const branchName = worktree.branch ?? worktree.path;

  const [name, setName] = useState(branchName);
  const [nameEdited, setNameEdited] = useState(false);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<AdoptWorktreeError | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The default name waits for the sessions; an edit the user made stays.
  useEffect(() => {
    if (!found.data || nameEdited) return;
    setName(pickAdoptionName(found.data.lanes[0]?.sessions ?? [], branchName));
  }, [found.data, nameEdited, branchName]);

  const toggle = (session: ImportableSession) =>
    setUnticked((current) => {
      const next = new Set(current);
      const key = sessionKey(session);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const adopt = async () => {
    setBusy(true);
    setRefusal(null);
    setFailure(null);
    try {
      const result = await rpc.worktreeSources.adopt({
        repoId,
        path: worktree.path,
        name,
        sessions: sessions
          .filter((session) => !unticked.has(sessionKey(session)))
          .map(({ providerId, providerSessionId }) => ({ providerId, providerSessionId })),
      });
      if (!result.success) {
        setRefusal(result.error);
        return;
      }
      for (const { providerSessionId, error } of result.data.importFailures) {
        toast({
          title: 'A session was not imported',
          description: `${providerSessionId}: ${describeSessionImportError(error)}`,
          variant: 'destructive',
        });
      }
      onSuccess({
        workItemId: result.data.workItemId,
        sessionId: result.data.imported[0]?.sessionId ?? null,
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const pointLane = async (laneId: string) => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await rpc.worktreeSources.pointLaneAtFolder({ laneId, path: worktree.path });
      if (!result.success) {
        setFailure(`Could not point the lane at this folder (${result.error.type}).`);
        return;
      }
      onSuccess({ workItemId: result.data.workItemId, sessionId: null });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adopt {worktree.branch ?? 'this checkout'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="flex flex-col gap-3 pt-0">
        <p className="text-tiny tracking-tiny text-text-muted">
          {worktree.path} becomes a work item. It stays yours: Chord won’t change its files, run its
          setup, or remove it.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="adopt-worktree-name" className="text-tiny tracking-tiny text-text-muted">
            Name
          </label>
          <input
            id="adopt-worktree-name"
            value={name}
            onChange={(event) => {
              setNameEdited(true);
              setName(event.target.value);
            }}
            className="rounded-xs border border-border bg-surface px-2 py-1.5 text-body tracking-body text-text outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-tiny tracking-tiny text-text-muted">
            Agent sessions in this folder
          </span>
          {found.isLoading && (
            <span className="flex items-center gap-1.5 text-tiny tracking-tiny text-text-passive">
              <Loader2 className="h-3 w-3 animate-spin" /> Looking for sessions…
            </span>
          )}
          {found.error && (
            <p className="text-tiny tracking-tiny text-status-err">{found.error.message}</p>
          )}
          {found.data && sessions.length === 0 && (
            <span className="text-tiny tracking-tiny text-text-passive">None found.</span>
          )}
          {sessions.map((session) => (
            <SessionRow
              key={sessionKey(session)}
              session={session}
              ticked={!unticked.has(sessionKey(session))}
              onToggle={() => toggle(session)}
            />
          ))}
          {found.data?.failures.map((source) => (
            <p key={source.providerId} className="text-tiny tracking-tiny text-status-err">
              Couldn’t list {providerName(source.providerId)} sessions: {source.message}
            </p>
          ))}
        </div>
        {refusal && (
          <div role="alert" className="flex flex-col gap-1.5">
            <p className="text-tiny tracking-tiny text-status-err">
              {describeAdoptWorktreeError(refusal)}
            </p>
            {refusal.type === 'stale_lane' && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void pointLane(refusal.laneId)}
              >
                Point lane at this folder
              </Button>
            )}
          </div>
        )}
        {failure && (
          <p role="alert" className="text-tiny tracking-tiny text-status-err">
            {failure}
          </p>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || found.isLoading || name.trim().length === 0}
          onClick={() => void adopt()}
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Adopt
        </Button>
      </DialogFooter>
    </>
  );
}
