/**
 * What git said when a command failed, as `IExecutionContext.exec` rejects
 * with it (`execFile`'s error: `stderr`, `killed`): git's stderr, trimmed.
 * `String(error)` would put Node's "Command failed: git …" and the whole
 * command line before it, which is what a failure banner must not show
 * (devstation-kcvy). A command its timeout killed has printed nothing, so
 * that is said instead.
 */
export function readGitFailureOutput(error: unknown): string {
  const { stderr, killed } = error as { stderr?: unknown; killed?: unknown };
  const printed = typeof stderr === 'string' ? stderr.trim() : '';
  if (printed) return printed;
  if (killed === true) return 'Stopped by its timeout before it answered.';
  return error instanceof Error ? error.message : String(error);
}
