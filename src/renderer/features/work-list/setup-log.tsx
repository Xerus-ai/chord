import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { describeRpcFailure } from './describe-action-failure';

const LOG_TAIL_LINES = 40;

/**
 * The tail of a lane's setup log, refreshed while setup runs — shown by the
 * provisioning bar and by Repo › Run & test.
 */
export function SetupLog({ worktreeId, status }: { worktreeId: string; status: string }) {
  const { data, error } = useQuery({
    queryKey: ['worktrees', 'setupLog', worktreeId, status],
    queryFn: async () => {
      const result = await rpc.worktrees.getSetupLog(worktreeId);
      if (!result.success) throw new Error(describeRpcFailure('Read setup log', result.error));
      return result.data.log;
    },
    refetchInterval: status === 'running' ? 1500 : false,
  });
  if (error) {
    return <p className="text-tiny tracking-tiny text-status-err">{error.message}</p>;
  }
  const tail = (data ?? '').trimEnd().split('\n').slice(-LOG_TAIL_LINES).join('\n');
  return (
    <pre className="max-h-48 overflow-auto rounded-xs bg-surface-inset px-2 py-1.5 font-mono text-tiny tracking-tiny whitespace-pre-wrap text-text-muted">
      {tail || 'No output yet.'}
    </pre>
  );
}
