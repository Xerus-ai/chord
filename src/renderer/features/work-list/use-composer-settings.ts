import { useCallback, useEffect, useState } from 'react';
import type { CatalogSelection } from '@shared/agent-control-catalog';
import { permissionModeChannel } from '@shared/events/permissionModeEvents';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { describeThrownFailure } from './describe-action-failure';

type SelectionPatch = { model?: string | null; effort?: string | null; fast?: boolean };

/**
 * A session tab's composer settings — model, effort, fast, permission mode —
 * as optimistic local state persisted to that session's config store (model,
 * effort, fast) and the permission-mode store (mode), so one tab's pick never
 * restarts a sibling session. A live Claude session takes the pick for its
 * next turn; other agents are restarted with it on their next send.
 *
 * `initialModel`/`initialEffort` (the work item's defaults) show until the
 * session's own stored pick arrives or the user chooses; each field's local
 * value wins once set, so a late load can't clobber a choice.
 */
export function useComposerSettings({
  workItemId,
  sessionId,
  initialEffort,
  initialModel,
}: {
  workItemId: string;
  sessionId: string;
  initialEffort: string | null;
  initialModel: string | null;
}) {
  const [override, setOverride] = useState<SelectionPatch>({});
  /** The session's mode pick, a catalog mode id; null = the agent's default. */
  const [permissionMode, setPermissionMode] = useState<string | null>(null);

  const selection: CatalogSelection = {
    model: override.model !== undefined ? override.model : initialModel,
    effort: override.effort !== undefined ? override.effort : initialEffort,
    fast: override.fast ?? false,
  };

  const persist = useCallback(
    (label: string, patch: SelectionPatch) => {
      setOverride((prev) => ({ ...prev, ...patch }));
      rpc.agentSessions.setChatSessionConfig({ sessionId, ...patch }).catch((e: unknown) => {
        toast({
          title: `${label} not saved`,
          description: describeThrownFailure(`Save ${label.toLowerCase()}`, e),
          variant: 'destructive',
        });
      });
    },
    [sessionId]
  );

  const onModelChange = useCallback((model: string) => persist('Model', { model }), [persist]);
  const onEffortChange = useCallback(
    (effort: string | null) => persist('Effort', { effort }),
    [persist]
  );
  const onFastChange = useCallback((fast: boolean) => persist('Fast mode', { fast }), [persist]);

  // A reopened session tab shows the session's own pick, not the work item's.
  useEffect(() => {
    rpc.agentSessions
      .getChatSessionConfig({ sessionId })
      .then((result) => {
        if (!result.success) return;
        const own = result.data.config;
        setOverride((prev) => ({
          model: prev.model !== undefined ? prev.model : own.model,
          effort: prev.effort !== undefined ? prev.effort : own.effort,
          fast: prev.fast ?? own.fast,
        }));
      })
      .catch((e: unknown) => {
        log.warn('[use-composer-settings] failed to read session config', e);
      });
  }, [sessionId]);

  const readPermissionMode = useCallback(() => {
    rpc.agentSessions
      .getChatPermissionMode({ workItemId, sessionId })
      .then((result) => {
        if (result.success) setPermissionMode(result.data.mode);
      })
      .catch((e: unknown) => {
        // Read-only: nothing to roll back, and a toast for every failed poll
        // would spam the user far more than the menu itself is worth.
        log.warn('[use-composer-settings] failed to read permission mode', e);
      });
  }, [workItemId, sessionId]);

  useEffect(() => {
    readPermissionMode();
  }, [readPermissionMode]);

  // The agent switched itself (Claude leaving plan, an ACP mode update) or an
  // approved plan moved it out of plan mode: main says so on this session's
  // topic.
  useEffect(
    () => events.on(permissionModeChannel, (update) => setPermissionMode(update.mode), sessionId),
    [sessionId]
  );

  const onPermissionModeChange = useCallback(
    (next: string) => {
      const before = permissionMode;
      setPermissionMode(next);
      rpc.agentSessions
        .setChatPermissionMode({ workItemId, sessionId, mode: next })
        .catch((e: unknown) => {
          setPermissionMode(before);
          toast({
            title: 'Permission mode not changed',
            description: describeThrownFailure('Switch permission mode', e),
            variant: 'destructive',
          });
        });
    },
    [workItemId, sessionId, permissionMode]
  );

  return {
    selection,
    permissionMode,
    onModelChange,
    onEffortChange,
    onFastChange,
    onPermissionModeChange,
  };
}
