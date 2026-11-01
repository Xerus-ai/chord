import type { LaneTestState } from '@shared/lane-runs';
import { statusDotClass } from '@renderer/lib/status-dot';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { describeTestResult } from './run-model';
import { RunTerminalToggle } from './run-script-row';
import { RunTerminal } from './run-terminal';

/**
 * The lane's test script: Run tests, the last result (Passed / Failed (exit
 * n) / Stopped) with how long it took and when, Stop while it runs, and its
 * full log in its terminal. Pass or fail is the exit code; runner output is
 * not parsed (plan §Phase 4, Test reports).
 */
export function RunTestRow({
  test,
  error,
  pending,
  onRun,
  onStop,
}: {
  test: LaneTestState;
  error: string | null;
  pending: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  const result = describeTestResult(test);
  return (
    <div role="group" aria-label="Test" className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'inline-block size-[6px] shrink-0 rounded-full',
            statusDotClass(result.signal)
          )}
        />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-list-meta text-text-passive">
          <span className="text-list-row text-text">{result.label}</span>
          {result.duration && <span>· {result.duration}</span>}
          {result.finishedAt !== null && (
            <span>
              · <RelativeTime value={result.finishedAt} />
            </span>
          )}
        </div>
        {result.canRun && (
          <Button variant="outline" size="xs" disabled={pending} onClick={onRun}>
            Run tests
          </Button>
        )}
        {result.canStop && (
          <Button variant="outline" size="xs" disabled={pending} onClick={onStop}>
            Stop
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-tiny tracking-tiny text-status-err">
          {error}
        </p>
      )}
      {test.ptySessionId && (
        <RunTerminalToggle
          ptySessionId={test.ptySessionId}
          // A new run is a new process: its terminal starts clean.
          render={(id) => <RunTerminal key={test.startedAt} ptySessionId={id} />}
        />
      )}
    </div>
  );
}
