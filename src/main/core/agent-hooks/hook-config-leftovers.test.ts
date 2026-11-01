import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as toml from 'smol-toml';
import { afterEach, describe, expect, it } from 'vitest';
import { createHookTestRepo, type HookTestRepo } from './_testing/hook-test-repo';
import { makeClaudeHookCommand, makeCodexNotifyCommand } from './agent-notify-command';
import { prepareAgentHookLaunch } from './hook-config';
import piChordExtension from './pi-chord-extension.ts?raw';

/**
 * Lanes where Chord launched an agent before its hooks moved to launch flags
 * hold what the old writer left: Chord's hook entries in
 * `.claude/settings.local.json`, its notify in `.codex/config.toml`, and those
 * paths appended to `.gitignore` (devstation-bmj). A launch cleans that up —
 * the hooks would otherwise fire twice — and touches nothing of the user's.
 */

const CLAUDE_SETTINGS = '.claude/settings.local.json';
const CODEX_CONFIG = '.codex/config.toml';
const PI_EXTENSION = '.pi/extensions/chord-hook.ts';

let t: HookTestRepo;

afterEach(() => {
  t.remove();
});

function writeLaneFile(path: string, content: string): void {
  mkdirSync(dirname(join(t.repo, path)), { recursive: true });
  writeFileSync(join(t.repo, path), content);
}

function readLaneFile(path: string): string {
  return readFileSync(join(t.repo, path), 'utf-8');
}

function chordClaudeEntry(eventType: string) {
  return { hooks: [{ type: 'command', command: makeClaudeHookCommand(eventType) }] };
}

/** `.claude/settings.local.json` as the old writer left it: the user's keys, then Chord's hooks appended. */
function writeOldClaudeSettings(user: {
  hooks?: Record<string, unknown[]>;
  [key: string]: unknown;
}) {
  const hooks = { ...(user.hooks ?? {}) };
  hooks.Notification = [...(hooks.Notification ?? []), chordClaudeEntry('notification')];
  hooks.Stop = [...(hooks.Stop ?? []), chordClaudeEntry('stop')];
  writeLaneFile(CLAUDE_SETTINGS, JSON.stringify({ ...user, hooks }, null, 2) + '\n');
}

/** `.gitignore` as the old writer appended to it (`ensureGitIgnoreEntries`). */
function appendOldGitIgnoreEntry(entry: string): void {
  const path = join(t.repo, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  const content = existing.replace(/\s*$/, '');
  writeFileSync(path, content.length > 0 ? `${content}\n${entry}\n` : `${entry}\n`);
}

function launch(providerId: 'claude' | 'codex' | 'pi') {
  return prepareAgentHookLaunch({
    providerId,
    sessionId: 'session-1',
    cwd: t.repo,
    launchDir: t.launchDir,
    claudeSettings: undefined,
    platform: process.platform,
  });
}

describe('a lane in the state the old hook writer left it', () => {
  it('comes back clean after a Claude launch: Chord’s settings file and its .gitignore line go', async () => {
    t = createHookTestRepo({ gitignore: 'node_modules/\n' });
    writeOldClaudeSettings({});
    appendOldGitIgnoreEntry(CLAUDE_SETTINGS);
    expect(t.porcelain(t.repo)).toBe(' M .gitignore\n');

    await launch('claude');

    expect(existsSync(join(t.repo, CLAUDE_SETTINGS))).toBe(false);
    expect(readLaneFile('.gitignore')).toBe('node_modules/\n');
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('comes back clean after a Codex launch: Chord’s config.toml and its .gitignore line go', async () => {
    t = createHookTestRepo({ gitignore: 'node_modules/\n' });
    writeLaneFile(
      CODEX_CONFIG,
      toml.stringify({ notify: makeCodexNotifyCommand({ platform: process.platform }) })
    );
    appendOldGitIgnoreEntry(CODEX_CONFIG);
    expect(t.porcelain(t.repo)).toBe(' M .gitignore\n');

    await launch('codex');

    expect(existsSync(join(t.repo, CODEX_CONFIG))).toBe(false);
    expect(readLaneFile('.gitignore')).toBe('node_modules/\n');
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('comes back clean from all three agents’ leftovers on one launch', async () => {
    t = createHookTestRepo({ gitignore: 'node_modules/\n' });
    writeOldClaudeSettings({});
    appendOldGitIgnoreEntry(CLAUDE_SETTINGS);
    writeLaneFile(
      CODEX_CONFIG,
      toml.stringify({ notify: makeCodexNotifyCommand({ platform: process.platform }) })
    );
    appendOldGitIgnoreEntry(CODEX_CONFIG);
    writeLaneFile(PI_EXTENSION, piChordExtension);
    appendOldGitIgnoreEntry(PI_EXTENSION);

    await launch('claude');

    expect(readLaneFile('.gitignore')).toBe('node_modules/\n');
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('deletes a .gitignore Chord created that holds nothing but its own line', async () => {
    t = createHookTestRepo({ gitignore: null });
    writeOldClaudeSettings({});
    appendOldGitIgnoreEntry(CLAUDE_SETTINGS);
    expect(t.porcelain(t.repo)).toBe('?? .gitignore\n');

    await launch('claude');

    expect(existsSync(join(t.repo, '.gitignore'))).toBe(false);
    expect(existsSync(join(t.repo, CLAUDE_SETTINGS))).toBe(false);
    expect(t.porcelain(t.repo)).toBe('');
  });
});

describe('what is the user’s stays as it is', () => {
  it('keeps the user’s own hook entries and settings, removing only Chord’s', async () => {
    t = createHookTestRepo({ gitignore: 'node_modules/\n.claude/\n' });
    const userStop = {
      hooks: [{ type: 'command', command: 'curl -sf http://127.0.0.1:9999/my-hook || true' }],
    };
    const user = { permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [userStop] } };
    writeOldClaudeSettings(user);

    await launch('claude');

    expect(readLaneFile(CLAUDE_SETTINGS)).toBe(JSON.stringify(user, null, 2) + '\n');
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('leaves a .gitignore the user also edited byte-for-byte alone', async () => {
    t = createHookTestRepo({ gitignore: 'node_modules/\n' });
    writeOldClaudeSettings({});
    writeLaneFile('.gitignore', 'node_modules/\ndist/\n');
    appendOldGitIgnoreEntry(CLAUDE_SETTINGS);
    const edited = readLaneFile('.gitignore');

    await launch('claude');

    expect(readLaneFile('.gitignore')).toBe(edited);
    expect(existsSync(join(t.repo, CLAUDE_SETTINGS))).toBe(false);
    expect(t.porcelain(t.repo)).toBe(' M .gitignore\n');
  });

  it('leaves a committed .gitignore line alone: it is part of the user’s history now', async () => {
    t = createHookTestRepo({ gitignore: `node_modules/\n${CLAUDE_SETTINGS}\n` });
    writeOldClaudeSettings({});

    await launch('claude');

    expect(readLaneFile('.gitignore')).toBe(`node_modules/\n${CLAUDE_SETTINGS}\n`);
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('keeps the user’s own Codex settings, removing only Chord’s notify', async () => {
    t = createHookTestRepo({ gitignore: 'node_modules/\n.codex/\n' });
    writeLaneFile(
      CODEX_CONFIG,
      toml.stringify({
        model: 'o3',
        notify: makeCodexNotifyCommand({ platform: process.platform }),
      })
    );

    await launch('codex');

    expect(toml.parse(readLaneFile(CODEX_CONFIG))).toEqual({ model: 'o3' });
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('leaves a Codex config whose notify is the user’s own byte-for-byte alone', async () => {
    t = createHookTestRepo({ gitignore: 'node_modules/\n.codex/\n' });
    const own = 'model = "o3"\nnotify = ["notify-send", "codex"]\n';
    writeLaneFile(CODEX_CONFIG, own);

    await launch('codex');

    expect(readLaneFile(CODEX_CONFIG)).toBe(own);
  });
});
