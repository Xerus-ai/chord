import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// The SDK reads CLAUDE_CONFIG_DIR once, at its first use, so the folder is set
// before anything imports it.
const claudeConfigDir = realpathSync(mkdtempSync(join(tmpdir(), 'chord-fork-claude-')));
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

const { resolveClaudeTranscriptPath } = await import(
  '@main/core/agent-sessions/claude-conversation-store'
);
const { CLAUDE_SESSION_ID, CLAUDE_TURN_1_REF, seedClaudeTranscript } = await import(
  './_testing/seed-transcripts'
);
const { forkClaudeConversation } = await import('./fork-claude-conversation');

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  rmSync(claudeConfigDir, { recursive: true, force: true });
});

describe('forkClaudeConversation (real Agent SDK, recorded transcript)', () => {
  it('forks at the turn: the fork keeps turn 1 only, and the original keeps both', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'chord-fork-cwd-')));
    const source = seedClaudeTranscript(claudeConfigDir, cwd);

    const { sessionId: forkId, forkedRefs } = await forkClaudeConversation({
      externalSessionId: CLAUDE_SESSION_ID,
      cwd,
      historyRef: CLAUDE_TURN_1_REF,
    });

    expect(forkId).not.toBe(CLAUDE_SESSION_ID);
    // The fork renames every entry; the map says what turn 1's ref became.
    const forkedTurn1 = forkedRefs.get(CLAUDE_TURN_1_REF);
    expect(forkedTurn1).toBeDefined();
    expect(forkedTurn1).not.toBe(CLAUDE_TURN_1_REF);
    // Chord's own resume check finds it in the cwd's project folder.
    const forked = resolveClaudeTranscriptPath(cwd, forkId);
    expect(forked).not.toBeNull();
    const forkedText = readFileSync(forked as string, 'utf8');
    expect(forkedText).toContain(`"uuid":"${forkedTurn1}"`);
    expect(forkedText).toContain('ALPHA-17');
    expect(forkedText).not.toContain('BRAVO-29');
    // Non-destructive: a wrong Reset loses nothing.
    expect(readFileSync(source, 'utf8')).toContain('BRAVO-29');
    rmSync(cwd, { recursive: true, force: true });
  });

  it('fails when the history ref is not in the conversation', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'chord-fork-cwd-')));
    seedClaudeTranscript(claudeConfigDir, cwd);

    await expect(
      forkClaudeConversation({
        externalSessionId: CLAUDE_SESSION_ID,
        cwd,
        historyRef: '00000000-0000-4000-8000-000000000000',
      })
    ).rejects.toThrow(/not found/);
    rmSync(cwd, { recursive: true, force: true });
  });
});
