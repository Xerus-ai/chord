import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';

const TMUX_SESSION_PREFIX = 'chord-';

/**
 * The returned line is parsed by a shell, so both words must be single-quoted.
 * Double quotes would leave `$(...)`, backticks and `$VAR` live for that shell
 * to expand before tmux ever sees them.
 */
export function buildTmuxShellLine(sessionName: string, commandLine: string): string {
  const quotedName = quoteShellArg(sessionName);
  const quotedCmd = quoteShellArg(commandLine);
  const checkExists = `tmux has-session -t ${quotedName} 2>/dev/null`;
  const newSession = `tmux new-session -d -s ${quotedName} ${quotedCmd}`;
  const attach = `tmux attach-session -t ${quotedName}`;
  return `(${checkExists} && ${attach}) || (${newSession} && ${attach})`;
}

export function makeTmuxSessionName(sessionId: string): string {
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
}

export async function killTmuxSession(ctx: IExecutionContext, sessionName: string): Promise<void> {
  try {
    await ctx.exec('tmux', ['kill-session', '-t', sessionName]);
  } catch (err) {
    log.debug('killTmuxSession: tmux session not found or already dead', {
      sessionName,
      error: String(err),
    });
  }
}
