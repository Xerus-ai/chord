/**
 * How a lane process ended, in the words both its row in the Run tab and its
 * terminal's last line use (devstation-0eth), so the two never disagree.
 */

/** A run script that is not running: the user stopped it, or it exited by itself. */
export function describeRunScriptEnd(
  status: 'stopped' | 'exited',
  exitCode: number | null
): string {
  if (status === 'stopped') return 'Stopped';
  return exitCode === null ? 'Exited' : `Exited ${exitCode}`;
}

/** A finished test run. A run the user stopped is not a failure. */
export function describeTestEnd(
  status: 'passed' | 'failed' | 'stopped',
  exitCode: number | null
): string {
  if (status === 'passed') return 'Passed';
  if (status === 'stopped') return 'Stopped';
  return exitCode === null ? 'Failed' : `Failed (exit ${exitCode})`;
}
