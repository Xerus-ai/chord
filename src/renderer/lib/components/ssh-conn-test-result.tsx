import { CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { ConnectionTestResult } from '@shared/ssh';

export type SshTestState = 'idle' | 'testing' | 'success' | 'error';

export function SshConnTestResult({
  state,
  result,
}: {
  state: Exclude<SshTestState, 'idle'>;
  result: ConnectionTestResult | null;
}) {
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const hasLogs = state === 'error' && !!result?.debugLogs?.length;

  return (
    <div className="rounded-md border border-border px-3 py-2 text-body tracking-body">
      <div className="flex items-center gap-2">
        {state === 'testing' && <LoaderCircle className="size-4 animate-spin text-text-muted" />}
        {state === 'success' && <CheckCircle2 className="size-4 text-status-ok" />}
        {state === 'error' && <XCircle className="size-4 text-status-err" />}
        <span className="flex-1 font-medium">
          {state === 'testing' && 'Testing connection…'}
          {state === 'success' &&
            'Connected' + (result?.latency ? ' (' + result.latency + 'ms)' : '')}
          {state === 'error' && (result?.error ?? 'Connection failed')}
        </span>
        {hasLogs && (
          <button
            type="button"
            onClick={() => setShowDebugLogs((v) => !v)}
            className="flex items-center gap-1 text-tiny tracking-tiny text-text-muted hover:text-text"
          >
            {showDebugLogs ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            Logs
          </button>
        )}
      </div>
      {showDebugLogs && result?.debugLogs && (
        <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-surface-inset px-2 py-1.5 text-code text-text-muted">
          {result.debugLogs.join('\n')}
        </pre>
      )}
    </div>
  );
}
