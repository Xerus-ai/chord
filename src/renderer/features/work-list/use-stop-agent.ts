import { useCallback, useState } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { describeThrownFailure } from './describe-action-failure';

/**
 * Stops every active session on a work item — what both "Stop All" controls
 * mean. Subagents have no individual handle to cancel: they run inside the
 * parent agent's session, so stopping the session is the whole operation.
 */
export function useStopAgent(workItemId: string) {
  const [stopping, setStopping] = useState(false);

  const stopAll = useCallback(() => {
    if (stopping) return;
    setStopping(true);
    rpc.chatMessages
      .stopAgent(workItemId)
      .catch((error: unknown) => {
        toast({
          title: 'Could not stop the agent',
          description: describeThrownFailure('Stop agent', error),
          variant: 'destructive',
        });
      })
      .finally(() => setStopping(false));
  }, [workItemId, stopping]);

  return { stopping, stopAll };
}
