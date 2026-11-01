import { cmdExeCommandLine } from '@main/utils/cmd-exe-command-line';

/**
 * Running a Windows batch file (`.cmd` / `.bat`) as a command.
 *
 * Node refuses to spawn one directly (`spawn EINVAL`, since the CVE-2024-27980
 * fix), and a batch file only runs inside cmd.exe anyway. npm installs every
 * global CLI on Windows as such a launcher (`<prefix>\opencode.cmd`), so a
 * command resolved through PATH is often one. It runs through cmd.exe on a
 * line passed verbatim (`cmdExeCommandLine`).
 */

const BATCH_FILE = /\.(cmd|bat)$/i;

export function isWindowsBatchFile(command: string): boolean {
  return process.platform === 'win32' && BATCH_FILE.test(command);
}

/** The cmd.exe invocation that runs `command args`, for `windowsVerbatimArguments`. */
export function batchFileInvocation(
  command: string,
  args: string[]
): { file: string; args: string[] } {
  const comSpec = process.env.ComSpec;
  if (!comSpec) throw new Error('ComSpec is not set; cannot run a batch file');
  return { file: comSpec, args: [cmdExeCommandLine(command, args, 'batch')] };
}
