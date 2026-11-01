import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexProjectKey, trustCodexLane } from './codex-folder-trust';

/**
 * A Codex terminal in a Chord lane opened on Codex's own folder-trust prompt
 * (devstation-xr1). Chord already decides what may run from the repository,
 * so it records the lane as trusted in Codex's config, as Codex does when the
 * user accepts, and as Chord does for Claude (`claude-trust-service.ts`).
 *
 * Trust also lets Codex load the repository's own `.codex/config.toml` (it can
 * start MCP servers), so a lane that carries one is left for Codex to ask
 * about. A decision already in the config, trusted or not, is the user's.
 * Real files in a temporary CODEX_HOME.
 */
let root: string;
let codexHome: string;
let lane: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chord-codex-trust-'));
  codexHome = join(root, 'codex-home');
  lane = join(root, 'lane');
  mkdirSync(codexHome);
  mkdirSync(lane);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const configPath = () => join(codexHome, 'config.toml');
const readConfig = () => readFileSync(configPath(), 'utf8');
const trustOf = (key: string) =>
  (parse(readConfig()).projects as Record<string, { trust_level?: string }> | undefined)?.[key]
    ?.trust_level;

describe('trustCodexLane', () => {
  it('records the lane as trusted and keeps the rest of the config as written', async () => {
    const before =
      '# my settings\nmodel = "gpt-6"\n\n[projects."D:\\\\other"]\ntrust_level = "trusted"\n';
    writeFileSync(configPath(), before);

    expect(await trustCodexLane({ cwd: lane, codexHome })).toBe('trusted');

    expect(readConfig().startsWith(before)).toBe(true);
    expect(trustOf(codexProjectKey(lane))).toBe('trusted');
  });

  it('creates the config when Codex has none yet', async () => {
    expect(await trustCodexLane({ cwd: lane, codexHome })).toBe('trusted');
    expect(trustOf(codexProjectKey(lane))).toBe('trusted');
  });

  it('leaves a decision the config already holds, trusted or not', async () => {
    const before = `[projects.${JSON.stringify(codexProjectKey(lane))}]\ntrust_level = "untrusted"\n`;
    writeFileSync(configPath(), before);

    expect(await trustCodexLane({ cwd: lane, codexHome })).toBe('already_decided');
    expect(readConfig()).toBe(before);
  });

  it("leaves a lane with the repository's own Codex config for Codex to ask about", async () => {
    mkdirSync(join(lane, '.codex'));
    writeFileSync(join(lane, '.codex', 'config.toml'), '[mcp_servers.x]\ncommand = "x"\n');

    expect(await trustCodexLane({ cwd: lane, codexHome })).toBe('repository_config');
    expect(() => readConfig()).toThrow();
  });

  it('refuses to edit a config it cannot read as TOML', async () => {
    writeFileSync(configPath(), 'model = \n');

    await expect(trustCodexLane({ cwd: lane, codexHome })).rejects.toThrow(/config\.toml/);
    expect(readConfig()).toBe('model = \n');
  });
});
