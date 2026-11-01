import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { turnStreamChannel } from '@shared/stream-items';
import type { AgentSessionRow } from '@main/db/schema-work-items';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { closeCenterTab, useCenterTabs } from './center-tabs-store';
import { keepSessionsOnLiveLanes } from './sessions-on-live-lanes';
import { useWorkItemWorktrees } from './use-work-item-worktrees';

const SESSIONS_CHANGED_EVENT = 'chord:work-item-sessions-changed';

/**
 * Tells this work item's open view that its sessions changed from outside
 * it — a terminal the sidebar started in a lane, which streams no turn to be
 * discovered by. Scoped by id, so a view showing another item ignores it.
 */
export function announceWorkItemSessionsChanged(workItemId: string): void {
  window.dispatchEvent(new CustomEvent(SESSIONS_CHANGED_EVENT, { detail: { workItemId } }));
}

/**
 * The owner's session rows for one work item, and the centre tabs that follow
 * them: live ones gain a tab, a lone chat session opens on first visit, and an
 * ended chat keeps a tab it was reopened in (`syncSessionTabsInLayout`).
 */
export function useWorkItemSessions(workItemId: string) {
  const [sessions, setSessions] = useState<AgentSessionRow[]>([]);
  // Until the first load, an empty list means "unknown", not "no sessions" — reconciling
  // against it would drop every restored session tab.
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const { syncSessions } = useCenterTabs(workItemId);

  const loadSessions = useCallback(() => {
    rpc.agentSessions
      .getAll(workItemId)
      .then((result) => {
        if (result.success) {
          setSessions(result.data.sessions);
          setSessionsLoaded(true);
        }
      })
      .catch(() => {});
  }, [workItemId]);

  // Closing a live session's tab ends it; an ended chat's tab (reopened to
  // read, step 5) just closes, and the chat stays listed under `+`.
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const closeSession = useCallback(
    (sessionId: string) => {
      closeCenterTab(workItemId, { kind: 'session', sessionId });
      if (sessionsRef.current.find((s) => s.id === sessionId)?.status === 'done') return;
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      rpc.agentSessions
        .markDone(sessionId)
        .then(() => loadSessions())
        .catch((err) => {
          log.error('closeSession: markDone failed', { sessionId, error: err });
        });
    },
    [workItemId, loadSessions]
  );

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // A session started or resumed from outside the launcher — typically by a
  // Room message — is only discovered when its turn streams. Reload the rows
  // then, so it gains (or regains) its tab.
  const activeSessionIds = useRef(new Set<string>());
  useEffect(() => {
    activeSessionIds.current = new Set(
      sessions.filter((s) => s.status === 'active').map((s) => s.id)
    );
  }, [sessions]);
  useEffect(
    () =>
      events.on(
        turnStreamChannel,
        (event) => {
          if (event.sessionId && !activeSessionIds.current.has(event.sessionId)) {
            activeSessionIds.current.add(event.sessionId);
            loadSessions();
          }
        },
        workItemId
      ),
    [workItemId, loadSessions]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as CustomEvent<{ workItemId: string }>).detail.workItemId === workItemId) {
        loadSessions();
      }
    };
    window.addEventListener(SESSIONS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, handler);
  }, [workItemId, loadSessions]);

  // The lanes the strip follows: a session on an archived lane loses its tab
  // (devstation-lf5i). `worktrees.list` returns live lanes only; until it has
  // loaded, nothing is synced, so no tab is dropped against an empty list.
  const liveWorktrees = useWorkItemWorktrees(workItemId);
  const liveWorktreeIds = useMemo(
    () => (liveWorktrees ? new Set(liveWorktrees.map((worktree) => worktree.id)) : null),
    [liveWorktrees]
  );

  useEffect(() => {
    if (!sessionsLoaded || !liveWorktreeIds) return;
    syncSessions(keepSessionsOnLiveLanes(sessions, liveWorktreeIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncSessions only closes over the stable store `apply` and workItemId; listing it would re-run on every tab transition
  }, [sessions, sessionsLoaded, liveWorktreeIds]);

  return { sessions, loadSessions, closeSession };
}
