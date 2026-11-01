import { statSync } from 'node:fs';
import type { ImportableSession } from '@shared/session-import';
import { resolveClaudeTranscriptPath } from '@main/core/agent-sessions/claude-conversation-store';
import { readClaudeTranscript } from './claude-transcript';
import type { ImportedMessage } from './transcript-builder';

/**
 * Claude sessions whose cwd is the lane and that Chord does not own, newest
 * first. `includeWorktrees: false` is the point: the SDK's default lists every
 * worktree of the repository for any one of them (spike S6). Programmatic
 * sessions stay in — `claude -p` is one.
 */
/**
 * When the session last changed: its transcript's mtime in whole ms, as
 * `Date#getTime` reads it. The SDK's `lastModified` rounds `mtimeMs`, so the
 * same file read a millisecond later half the time.
 */
function readTranscriptActivity(lanePath: string, providerSessionId: string): number {
  const file = resolveClaudeTranscriptPath(lanePath, providerSessionId);
  if (!file) throw new SessionNotFoundError(providerSessionId);
  return Math.trunc(statSync(file).mtimeMs);
}

export async function listClaudeImportableSessions(
  lanePath: string,
  owned: ReadonlySet<string>
): Promise<ImportableSession[]> {
  const { listSessions } = await import('@anthropic-ai/claude-agent-sdk');
  const sessions = await listSessions({ dir: lanePath, includeWorktrees: false });
  return (
    sessions
      .filter((session) => !owned.has(session.sessionId))
      .map((session) => ({
        providerId: 'claude' as const,
        providerSessionId: session.sessionId,
        // The SDK's summary is already the /rename title, else Claude's title,
        // else the last or first prompt.
        title: session.summary,
        lastActivityAt: readTranscriptActivity(lanePath, session.sessionId),
        cwd: lanePath,
      }))
      // Newest first by the activity shown, not the SDK's order (its rounded mtime).
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
  );
}

export class SessionNotFoundError extends Error {
  constructor(providerSessionId: string) {
    super(`No session ${providerSessionId} in this folder`);
    this.name = 'SessionNotFoundError';
  }
}

export interface ProviderSessionHistory {
  title: string | null;
  /** ms epoch */
  lastActivityAt: number | null;
  messages: ImportedMessage[];
}

/** A Claude session's title, last activity and whole conversation, from its transcript. */
export async function readClaudeSessionHistory(
  lanePath: string,
  providerSessionId: string
): Promise<ProviderSessionHistory> {
  const file = resolveClaudeTranscriptPath(lanePath, providerSessionId);
  if (!file) throw new SessionNotFoundError(providerSessionId);
  const messages = await readClaudeTranscript(file, lanePath);
  const { getSessionInfo } = await import('@anthropic-ai/claude-agent-sdk');
  const info = await getSessionInfo(providerSessionId, { dir: lanePath });
  return {
    title: info?.summary ?? null,
    lastActivityAt: Math.trunc(statSync(file).mtimeMs),
    messages,
  };
}
