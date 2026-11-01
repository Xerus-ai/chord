/**
 * The command line that has cmd.exe run one command with its arguments
 * exactly as given: `/d /s /c "<command> <args>"`, to pass verbatim (node-pty
 * string args, or Node's `windowsVerbatimArguments`) — an argv-quoting layer
 * would escape its quotes as `\"`, which cmd.exe does not read.
 *
 * cmd.exe parses the line before the program sees it, and a batch file's `%*`
 * parses it a second time. Each argument is quoted the way a program reads its
 * argv, then every cmd.exe metacharacter — the quotes included, so cmd.exe
 * never enters a quoted region where `^` is literal — is caret-escaped once
 * for a program and twice for a batch file (https://qntm.org/cmd; the
 * algorithm of `cross-spawn`). The command path is quoted rather than escaped:
 * a program in a folder with a space reads an escaped path as several
 * arguments. Probed live: `chord-lane-checks/probe-9ge` (devstation-9ge).
 */

export type CmdExeTarget = 'program' | 'batch';

const LINE_BREAK = /[\r\n]/;
const PLAIN_ARG = /^[\w.\-\\/:@+]+$/;
const CMD_METACHARS = /([()\][%!^"`<>&|;, *?])/g;

function refuseLineBreak(value: string, what: string): void {
  if (LINE_BREAK.test(value)) {
    throw new Error(
      `Cannot pass ${what} ${JSON.stringify(value)} to cmd.exe: a line break ends its command line`
    );
  }
}

function quoteForArgv(arg: string): string {
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

function escapeArgument(arg: string, target: CmdExeTarget): string {
  refuseLineBreak(arg, 'the argument');
  if (PLAIN_ARG.test(arg)) return arg;
  const once = quoteForArgv(arg).replace(CMD_METACHARS, '^$1');
  return target === 'batch' ? once.replace(CMD_METACHARS, '^$1') : once;
}

export function cmdExeCommandLine(command: string, args: string[], target: CmdExeTarget): string {
  refuseLineBreak(command, 'the command');
  if (command.includes('"')) {
    throw new Error(`Cannot run ${JSON.stringify(command)} through cmd.exe: it holds a quote`);
  }
  const line = [`"${command}"`, ...args.map((arg) => escapeArgument(arg, target))].join(' ');
  return `/d /s /c "${line}"`;
}
