import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import * as toml from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHookTestRepo, type HookTestRepo } from './_testing/hook-test-repo';
import { makeClaudeHookCommand, makeCodexNotifyCommand } from './agent-notify-command';
import { prepareAgentHookLaunch } from './hook-config';

/**
 * How Chord hands its hooks to an agent CLI it launches. Chord's own agent
 * config must never show up as the user's change (devstation-bmj,
 * devstation-tx0): Claude Code and Codex get it through launch flags, Pi's
 * extension file is excluded in `.git/info/exclude`, never the tracked
 * .gitignore.
 */

let t: HookTestRepo;

function isInside(dir: string, file: string): boolean {
  const rel = relative(resolve(dir), resolve(file));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function launch(
  providerId: Parameters<typeof prepareAgentHookLaunch>[0]['providerId'],
  overrides: Partial<Parameters<typeof prepareAgentHookLaunch>[0]> = {}
) {
  return prepareAgentHookLaunch({
    providerId,
    sessionId: 'session-1',
    cwd: t.repo,
    launchDir: t.launchDir,
    claudeSettings: undefined,
    platform: process.platform,
    ...overrides,
  });
}

beforeEach(() => {
  t = createHookTestRepo({ gitignore: 'node_modules/\n' });
});

afterEach(() => {
  t.remove();
});

describe('prepareAgentHookLaunch — Claude Code', () => {
  it('passes Chord’s hooks in one --settings file outside the checkout, and the lane stays clean', async () => {
    const result = await launch('claude', { claudeSettings: { enableArtifact: false } });

    expect(result.args).toHaveLength(2);
    expect(result.args[0]).toBe('--settings');
    const settingsPath = result.args[1]!;
    expect(isInside(t.launchDir, settingsPath)).toBe(true);
    expect(isInside(t.repo, settingsPath)).toBe(false);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    // The rest of Chord's flag settings ride in the same file: with two
    // --settings flags Claude Code applies only the last (probe-bmj).
    expect(settings.enableArtifact).toBe(false);
    expect(settings.hooks.Notification).toEqual([
      { hooks: [{ type: 'command', command: makeClaudeHookCommand('notification') }] },
    ]);
    expect(settings.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: makeClaudeHookCommand('stop') }] },
    ]);

    expect(existsSync(join(t.repo, '.claude'))).toBe(false);
    expect(readFileSync(join(t.repo, '.gitignore'), 'utf-8')).toBe('node_modules/\n');
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('writes the hooks alone when Chord has no other flag settings for the session', async () => {
    const result = await launch('claude');

    const settings = JSON.parse(readFileSync(result.args[1]!, 'utf-8'));
    expect(Object.keys(settings)).toEqual(['hooks']);
    expect(Object.keys(settings.hooks).sort()).toEqual(['Notification', 'Stop']);
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('leaves the user’s own committed .claude/settings.local.json byte-for-byte alone', async () => {
    mkdirSync(join(t.repo, '.claude'));
    const own = '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n';
    writeFileSync(join(t.repo, '.claude', 'settings.local.json'), own);
    t.git(t.repo, 'add', '-f', '.claude/settings.local.json');
    t.git(t.repo, 'commit', '-q', '-m', 'own local settings');

    await launch('claude');

    expect(readFileSync(join(t.repo, '.claude', 'settings.local.json'), 'utf-8')).toBe(own);
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('removes the settings file when the terminal ends', async () => {
    const result = await launch('claude');
    const settingsPath = result.args[1]!;
    expect(existsSync(settingsPath)).toBe(true);

    result.cleanup();

    expect(existsSync(settingsPath)).toBe(false);
  });
});

describe('prepareAgentHookLaunch — Codex', () => {
  it('passes notify as a -c override and writes no .codex/config.toml (POSIX command)', async () => {
    const result = await launch('codex', { platform: 'linux' });

    expect(result.args).toHaveLength(2);
    expect(result.args[0]).toBe('-c');
    expect(result.args[1]!.startsWith('notify=')).toBe(true);
    // Codex parses the value as TOML (`codex --help`, -c).
    expect(toml.parse(result.args[1]!).notify).toEqual(
      makeCodexNotifyCommand({ platform: 'linux' })
    );

    expect(existsSync(join(t.repo, '.codex'))).toBe(false);
    expect(readFileSync(join(t.repo, '.gitignore'), 'utf-8')).toBe('node_modules/\n');
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('passes the Windows notify command with no double quote, so a codex.cmd shim keeps it intact', async () => {
    const result = await launch('codex', { platform: 'win32' });

    expect(result.args[0]).toBe('-c');
    expect(result.args[1]).not.toContain('"');
    expect(toml.parse(result.args[1]!).notify).toEqual(
      makeCodexNotifyCommand({ platform: 'win32' })
    );
    expect(existsSync(join(t.repo, '.codex'))).toBe(false);
    expect(t.porcelain(t.repo)).toBe('');
  });
});

describe('prepareAgentHookLaunch — Pi', () => {
  it('writes the Pi extension and excludes it in .git/info/exclude, never the tracked .gitignore', async () => {
    const result = await launch('pi');

    expect(result.args).toEqual([]);
    expect(readFileSync(join(t.repo, '.pi', 'extensions', 'chord-hook.ts'), 'utf-8')).toContain(
      "pi.on('agent_end'"
    );
    expect(readFileSync(join(t.repo, '.gitignore'), 'utf-8')).toBe('node_modules/\n');
    expect(t.porcelain(t.repo)).toBe('');
  });

  it('excludes it once, in a linked worktree too', async () => {
    const lane = join(t.root, 'lane');
    t.git(t.repo, 'worktree', 'add', '-q', '-b', 'feat/lane', lane);

    for (const sessionId of ['session-1', 'session-2']) {
      await launch('pi', { sessionId, cwd: lane });
    }

    expect(existsSync(join(lane, '.pi', 'extensions', 'chord-hook.ts'))).toBe(true);
    expect(t.porcelain(lane)).toBe('');
    const excluded = readFileSync(t.excludeFile(lane), 'utf-8')
      .split(/\r?\n/)
      .filter((line) => line.includes('chord-hook.ts'));
    expect(excluded).toHaveLength(1);
  });
});

describe('prepareAgentHookLaunch — agents without Chord hooks', () => {
  it('adds no flag and writes nothing', async () => {
    const result = await launch('gemini');

    expect(result.args).toEqual([]);
    expect(existsSync(t.launchDir)).toBe(false);
    expect(t.porcelain(t.repo)).toBe('');
  });
});
