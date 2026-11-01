import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeClaudeProjectDir } from '@main/core/agent-sessions/claude-conversation-store';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { ClaudeTranscriptWriter, text, writeTranscript } from './_testing/claude-records';
import { listClaudeImportableSessions } from './claude-session-source';

/**
 * Which Claude sessions a lane offers to import, read through the installed
 * Claude Agent SDK's own `listSessions` against a real config directory and a
 * real git repository with a linked worktree — the case `includeWorktrees`
 * exists for: by default the SDK lists every worktree's sessions for any one
 * of them (spike S6), and a lane must offer only its own.
 */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-claude-source-')));
const configDir = join(root, 'claude-config');
const repo = join(root, 'repo');
const lane = join(root, 'lane-ledger');
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

function projectDir(cwd: string): string {
  return join(configDir, 'projects', encodeClaudeProjectDir(cwd));
}

/** A finished one-prompt conversation in `cwd`; returns its id and file. */
function writeSession(
  cwd: string,
  prompt: string,
  extra: (w: ClaudeTranscriptWriter) => void = () => {}
) {
  const sessionId = randomUUID();
  const writer = new ClaudeTranscriptWriter({
    sessionId,
    cwd,
    startAt: Date.parse('2026-10-02T08:00:00Z'),
  });
  writer.prompt(prompt);
  writer.assistant([text('ok')]);
  extra(writer);
  return { sessionId, file: writeTranscript(projectDir(cwd), sessionId, writer) };
}

let laneTitled: { sessionId: string; file: string };
let laneRenamed: { sessionId: string; file: string };
let laneUntitled: { sessionId: string; file: string };
let laneOwned: { sessionId: string; file: string };
let mainSession: { sessionId: string; file: string };

beforeAll(() => {
  mkdirSync(configDir, { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = configDir;
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord test');
  writeFileSync(join(repo, 'README.md'), '# ledger\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'readme');
  git(repo, 'worktree', 'add', '-q', '-b', 'raghav/ledger', lane);

  laneTitled = writeSession(lane, 'Migrate the ledger job', (w) =>
    w.meta({ type: 'ai-title', aiTitle: 'Ledger job migration' })
  );
  laneRenamed = writeSession(lane, 'Fix the flaky test', (w) => {
    w.meta({ type: 'ai-title', aiTitle: 'Flaky test fix' });
    w.meta({ type: 'custom-title', customTitle: 'CI flake hunt' });
  });
  laneUntitled = writeSession(lane, 'Why is the build slow?');
  laneOwned = writeSession(lane, 'Started by Chord', (w) =>
    w.meta({ type: 'ai-title', aiTitle: 'A Chord chat' })
  );
  mainSession = writeSession(repo, 'Work in the main checkout', (w) =>
    w.meta({ type: 'ai-title', aiTitle: 'Main checkout work' })
  );
});

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  removeDirSync(root);
});

describe('listClaudeImportableSessions', () => {
  it("lists the lane's own sessions with their title and last activity", async () => {
    const sessions = await listClaudeImportableSessions(lane, new Set([laneOwned.sessionId]));
    const byId = new Map(sessions.map((s) => [s.providerSessionId, s]));

    expect(byId.get(laneTitled.sessionId)).toEqual({
      providerId: 'claude',
      providerSessionId: laneTitled.sessionId,
      title: 'Ledger job migration',
      lastActivityAt: Math.trunc(statSync(laneTitled.file).mtimeMs),
      cwd: lane,
    });
  });

  it("prefers the user's /rename title, then Claude's title, then the first prompt", async () => {
    const sessions = await listClaudeImportableSessions(lane, new Set());
    const title = (id: string) => sessions.find((s) => s.providerSessionId === id)?.title;
    expect(title(laneRenamed.sessionId)).toBe('CI flake hunt');
    expect(title(laneTitled.sessionId)).toBe('Ledger job migration');
    expect(title(laneUntitled.sessionId)).toBe('Why is the build slow?');
  });

  it('leaves out sessions Chord already owns', async () => {
    const sessions = await listClaudeImportableSessions(lane, new Set([laneOwned.sessionId]));
    expect(sessions.map((s) => s.providerSessionId)).not.toContain(laneOwned.sessionId);
    expect(sessions).toHaveLength(3);
  });

  it("does not offer the main checkout's sessions in a linked worktree's lane, or the other way round", async () => {
    const laneIds = (await listClaudeImportableSessions(lane, new Set())).map(
      (s) => s.providerSessionId
    );
    const mainIds = (await listClaudeImportableSessions(repo, new Set())).map(
      (s) => s.providerSessionId
    );

    expect(laneIds).not.toContain(mainSession.sessionId);
    expect(mainIds).toEqual([mainSession.sessionId]);
  });

  it('lists nothing for a lane no Claude session ran in', async () => {
    const empty = join(root, 'never-used');
    mkdirSync(empty, { recursive: true });
    expect(await listClaudeImportableSessions(empty, new Set())).toEqual([]);
  });

  it('newest first', async () => {
    const sessions = await listClaudeImportableSessions(lane, new Set());
    const times = sessions.map((s) => s.lastActivityAt ?? 0);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
