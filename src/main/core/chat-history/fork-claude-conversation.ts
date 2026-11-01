import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  claudeConfigDir,
  encodeClaudeProjectDir,
  resolveClaudeTranscriptPath,
} from '@main/core/agent-sessions/claude-conversation-store';

/**
 * The fork's entries by the entry each was copied from: a fork gives every
 * entry a new uuid and records the original as `forkedFrom.messageUuid`.
 */
function readForkedRefs(cwd: string, forkId: string): Map<string, string> {
  const path = resolveClaudeTranscriptPath(cwd, forkId);
  if (!path) throw new Error(`forkClaudeConversation: fork ${forkId} has no transcript in ${cwd}`);
  const refs = new Map<string, string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as {
      uuid?: unknown;
      forkedFrom?: { messageUuid?: unknown };
    };
    const source = entry.forkedFrom?.messageUuid;
    if (typeof entry.uuid === 'string' && typeof source === 'string') refs.set(source, entry.uuid);
  }
  return refs;
}

/**
 * Moves a forked transcript into `cwd`'s project folder, where Claude resumes
 * it in that cwd (spike S1): Claude Code only looks in the folder of the cwd
 * it runs in.
 */
function moveTranscript(fromCwd: string, sessionId: string, cwd: string): void {
  const from = resolveClaudeTranscriptPath(fromCwd, sessionId);
  if (!from)
    throw new Error(`forkClaudeConversation: fork ${sessionId} has no transcript in ${fromCwd}`);
  const dir = join(claudeConfigDir(), 'projects', encodeClaudeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  renameSync(from, join(dir, `${sessionId}.jsonl`));
}

/**
 * Forks a Claude conversation through `historyRef` (a turn's last transcript
 * entry, inclusive). The fork is written to `cwd`'s project folder, where
 * Chord resumes it, or moved on to `into`'s for a fork that continues in
 * another checkout. The source checkout need not exist any more. The
 * original transcript is left as it is, so nothing is lost (spike S1).
 * `forkedRefs` maps an original entry's uuid to its copy's, which is what an
 * earlier turn's history ref becomes in the fork.
 */
export async function forkClaudeConversation(args: {
  externalSessionId: string;
  cwd: string;
  historyRef: string;
  into?: string;
}): Promise<{ sessionId: string; forkedRefs: ReadonlyMap<string, string> }> {
  const { forkSession } = await import('@anthropic-ai/claude-agent-sdk');
  const { sessionId } = await forkSession(args.externalSessionId, {
    dir: args.cwd,
    upToMessageId: args.historyRef,
  });
  const forkedRefs = readForkedRefs(args.cwd, sessionId);
  if (args.into) moveTranscript(args.cwd, sessionId, args.into);
  return { sessionId, forkedRefs };
}
