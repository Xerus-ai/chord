import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeClaudeProjectDir } from '@main/core/agent-sessions/claude-conversation-store';

/**
 * Two-turn conversations recorded from the real agents (spikes S1 and S2,
 * `chord-lane-checks/probe-s1`, `probe-s2`): turn 1 asks to remember ALPHA-17,
 * turn 2 BRAVO-29. Trimmed to the conversation itself (no attachments,
 * instructions or environment) and with the recording's cwd replaced by
 * `FIXTURE_CWD`, which a seed fills with the test's own folder.
 */

export const CLAUDE_SESSION_ID = '5fcee712-8947-48e1-a28f-8b9aa69db1df';
/** The last entry of Claude's turn 1 (its "OK"), where a Reset to turn 1 cuts. */
export const CLAUDE_TURN_1_REF = '86de37d9-cf18-49b2-9243-cef21fa1ff24';
export const CLAUDE_TURN_2_REF = 'd4d640bb-d69c-43dd-8223-5fbf212710aa';

export const CODEX_THREAD_ID = '01a10858-9514-7491-ac86-0075c277e3de';
export const CODEX_TURN_1_ID = '01a10858-9846-7012-b96a-4d694ae380f0';
export const CODEX_TURN_2_ID = '01a10858-b28e-7e63-b5a2-0b4c086937fc';

function readFixture(name: string, cwd: string): string {
  const text = readFileSync(join(__dirname, name), 'utf8');
  // The cwd sits inside JSON strings, so it is written escaped.
  return text.replaceAll('FIXTURE_CWD', JSON.stringify(cwd).slice(1, -1));
}

/** Writes the Claude conversation where Claude Code keeps `cwd`'s transcripts; returns its path. */
export function seedClaudeTranscript(claudeConfigDir: string, cwd: string): string {
  const dir = join(claudeConfigDir, 'projects', encodeClaudeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${CLAUDE_SESSION_ID}.jsonl`);
  writeFileSync(file, readFixture('claude-two-turns.jsonl', cwd));
  return file;
}

/**
 * Writes the Codex thread's rollout under `codexHome`, as Codex stores it. The
 * home's config switches plugins off: otherwise every server start syncs them
 * with `git ls-remote https://github.com/openai/plugins.git`, a network call
 * that outlives the server and holds the home open.
 */
export function seedCodexRollout(codexHome: string, cwd: string): void {
  writeFileSync(
    join(codexHome, 'config.toml'),
    '[features]\nplugins = false\nremote_plugin = false\n'
  );
  const dir = join(codexHome, 'sessions', '2026', '10', '05');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `rollout-2026-10-05T00-46-25-${CODEX_THREAD_ID}.jsonl`),
    readFixture('codex-two-turns.jsonl', cwd)
  );
}
