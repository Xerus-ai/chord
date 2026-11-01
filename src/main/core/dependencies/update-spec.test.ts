import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_PROVIDERS, getProvider } from '@shared/agent-providers';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import {
  createNpmPrefix,
  npmInstallGlobal,
  packFixturePackage,
  removeNpmPrefix,
  useNpmPrefix,
} from './_testing/npm-prefix-fixture';
import { CODEX_LATEST_CHANNEL_URL } from './latest-version';
import { resolveCommandPath } from './probe';
import {
  readNpmGlobalLocation,
  resolveAgentUpdateSpec,
  type NpmGlobalLocation,
} from './update-spec';

/**
 * Which command updates an installed agent, and where its latest version is
 * read, is decided from how it was installed — never guessed (devstation-ext).
 *
 *   - Codex: `codex update`. Codex detects its own install method and runs the
 *     matching updater (codex-rs `cli/src/main.rs` run_update_command →
 *     `tui/src/update_action.rs`). Its latest version is npm's `latest` when
 *     the binary is npm's, otherwise the native installer's release channel.
 *   - Other agents: `npm install -g <pkg>@latest`, only when the binary on PATH
 *     is npm's global install of that package. Any other install method gets
 *     no update command (the row shows the version only).
 *   - Claude Code: none in v1; it updates itself.
 *
 * Installs are real: `npm install -g` into a temporary prefix that npm and PATH
 * point at. `@openai/codex` there is a packed stand-in package (bin `codex`)
 * installed the same way, so npm lays it out as it lays out the real one.
 */
let prefix: string;
let packDir: string;
let restoreEnv: () => void;
let npmGlobal: NpmGlobalLocation;
let markedPath: string;
let npmCodexPath: string;

beforeAll(async () => {
  prefix = createNpmPrefix();
  npmInstallGlobal(prefix, 'marked@12.0.0');
  packDir = realpathSync(mkdtempSync(join(tmpdir(), 'chord-npm-pack-')));
  const codexTarball = packFixturePackage(packDir, {
    name: '@openai/codex',
    version: '0.1.0',
    bin: 'codex',
    versionLine: 'codex-cli 0.1.0',
  });
  npmInstallGlobal(prefix, `"${codexTarball}"`);
  restoreEnv = useNpmPrefix(prefix);

  const ctx = new LocalExecutionContext();
  npmGlobal = await readNpmGlobalLocation(ctx);
  const marked = await resolveCommandPath('marked', ctx);
  const codex = await resolveCommandPath('codex', ctx);
  if (!marked || !codex) throw new Error('fixture CLIs are not on PATH');
  markedPath = marked;
  npmCodexPath = codex;
}, 180_000);

afterAll(() => {
  restoreEnv?.();
  if (prefix) removeNpmPrefix(prefix);
  if (packDir) removeNpmPrefix(packDir);
});

describe('readNpmGlobalLocation', () => {
  it('reports the global prefix and package root npm itself uses', () => {
    const root =
      process.platform === 'win32'
        ? join(prefix, 'node_modules')
        : join(prefix, 'lib', 'node_modules');

    expect(realpathSync(npmGlobal.prefix)).toBe(prefix);
    expect(realpathSync(npmGlobal.root)).toBe(realpathSync(root));
  });
});

describe('resolveAgentUpdateSpec — npm agents', () => {
  it('updates an npm-installed agent with npm, reading npm for its latest version', () => {
    const spec = resolveAgentUpdateSpec(
      { id: 'opencode', npmPackage: 'marked', resolvedPath: markedPath },
      npmGlobal
    );

    expect(spec).toEqual({
      command: 'npm install -g marked@latest',
      source: { kind: 'npm', package: 'marked' },
    });
  });

  it('recognises npm’s install when PATH reaches the prefix through a link', () => {
    // nvm-windows: PATH has `C:\Program Files\nodejs`, a link to
    // `%APPDATA%\nvm\v24.15.0` (measured on this machine 2026-10-04).
    const linkedPrefix = join(packDir, 'nodejs-link');
    symlinkSync(prefix, linkedPrefix, process.platform === 'win32' ? 'junction' : 'dir');
    const linkedPath = join(linkedPrefix, relative(prefix, markedPath));

    const spec = resolveAgentUpdateSpec(
      { id: 'opencode', npmPackage: 'marked', resolvedPath: linkedPath },
      npmGlobal
    );

    expect(spec).toEqual({
      command: 'npm install -g marked@latest',
      source: { kind: 'npm', package: 'marked' },
    });
  });

  it('offers no update for an agent binary that is not npm’s global install', () => {
    const spec = resolveAgentUpdateSpec(
      { id: 'opencode', npmPackage: 'marked', resolvedPath: process.execPath },
      npmGlobal
    );

    expect(spec).toBeNull();
  });

  it('offers no update when the npm package on PATH is not the agent’s package', () => {
    const spec = resolveAgentUpdateSpec(
      { id: 'gemini', npmPackage: '@google/gemini-cli', resolvedPath: markedPath },
      npmGlobal
    );

    expect(spec).toBeNull();
  });

  it('offers no update for an agent with no npm package', () => {
    const spec = resolveAgentUpdateSpec(
      { id: 'droid', npmPackage: undefined, resolvedPath: markedPath },
      npmGlobal
    );

    expect(spec).toBeNull();
  });
});

describe('resolveAgentUpdateSpec — Codex', () => {
  it('a native Codex runs `codex update` and reads the release channel', () => {
    const spec = resolveAgentUpdateSpec(
      { id: 'codex', npmPackage: '@openai/codex', resolvedPath: process.execPath },
      npmGlobal
    );

    expect(spec).toEqual({
      command: 'codex update',
      source: { kind: 'codex-channel', url: CODEX_LATEST_CHANNEL_URL },
    });
  });

  it('an npm Codex runs `codex update` and reads npm', () => {
    const spec = resolveAgentUpdateSpec(
      { id: 'codex', npmPackage: '@openai/codex', resolvedPath: npmCodexPath },
      npmGlobal
    );

    expect(spec).toEqual({
      command: 'codex update',
      source: { kind: 'npm', package: '@openai/codex' },
    });
  });
});

describe('resolveAgentUpdateSpec — Claude Code', () => {
  it('offers no update, even for an npm install', () => {
    const spec = resolveAgentUpdateSpec(
      { id: 'claude', npmPackage: 'marked', resolvedPath: markedPath },
      npmGlobal
    );

    expect(spec).toBeNull();
  });
});

describe('agent provider npm packages', () => {
  it('names the npm package of every agent installed with `npm install -g`', () => {
    const npmInstalled = AGENT_PROVIDERS.flatMap((provider) => {
      const match = /^npm (?:install|i) -g (\S+)$/.exec(provider.installCommand ?? '');
      return match ? [{ id: provider.id, pkg: match[1].replace(/@latest$/, '') }] : [];
    });

    expect(npmInstalled.length).toBeGreaterThan(5);
    for (const { id, pkg } of npmInstalled) {
      expect({ id, npmPackage: getProvider(id)?.npmPackage }).toEqual({ id, npmPackage: pkg });
    }
  });

  it('gives Codex its npm package and Claude Code none', () => {
    expect(getProvider('codex')?.npmPackage).toBe('@openai/codex');
    expect(getProvider('claude')?.npmPackage).toBeUndefined();
  });
});
