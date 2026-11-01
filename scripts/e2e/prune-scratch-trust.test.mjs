import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneScratchCodexTrust } from './prune-scratch-trust.mjs';

/**
 * e2e runs trust their scratch lanes in the user's own Codex config, and the
 * entries outlived the folders (devstation-xvgp: 34 of 44 projects in one
 * config). The harness removes the trust of folders under the OS temp folder
 * that are gone, and nothing else: the rest of the file is kept as written.
 */
describe('pruneScratchCodexTrust', () => {
  let dir;
  let tempRoot;
  let configPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prune-scratch-trust-'));
    tempRoot = join(dir, 'Temp');
    mkdirSync(tempRoot);
    configPath = join(dir, 'config.toml');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes the trust of scratch folders that are gone, keeping everything else as written', () => {
    const live = join(tempRoot, 'chord-run-live');
    mkdirSync(live);
    const gone = join(tempRoot, 'chord-run-gone');
    const goneLower = join(tempRoot, 'chord-history-codex-x', 'root').toLowerCase();
    const config = [
      'model = "gpt-6-astra"',
      '# my own note',
      '',
      `[projects.${JSON.stringify('D:\\work\\my-project')}]`,
      'trust_level = "trusted"',
      '',
      `[projects.${JSON.stringify(gone)}]`,
      'trust_level = "trusted"',
      '',
      `[projects.${JSON.stringify(live)}]`,
      'trust_level = "trusted"',
      '',
      '[features]',
      'unified_exec = true',
      '',
      `[projects.'${goneLower}']`,
      'trust_level = "trusted"',
      '',
      `[projects.${JSON.stringify(`\\\\?\\${gone}-2`)}]`,
      'trust_level = "trusted"',
      '',
    ].join('\r\n');
    writeFileSync(configPath, config);

    const removed = pruneScratchCodexTrust({ configPath, tempRoot });

    expect(removed).toEqual([gone, goneLower, `\\\\?\\${gone}-2`]);
    expect(readFileSync(configPath, 'utf8')).toBe(
      [
        'model = "gpt-6-astra"',
        '# my own note',
        '',
        `[projects.${JSON.stringify('D:\\work\\my-project')}]`,
        'trust_level = "trusted"',
        '',
        `[projects.${JSON.stringify(live)}]`,
        'trust_level = "trusted"',
        '',
        '[features]',
        'unified_exec = true',
        '',
      ].join('\r\n')
    );
  });

  it('does not touch the file when there is nothing to remove', () => {
    const config = `[projects.${JSON.stringify('D:\\work')}]\ntrust_level = "trusted"\n`;
    writeFileSync(configPath, config);
    const before = statSync(configPath).mtimeMs;

    expect(pruneScratchCodexTrust({ configPath, tempRoot })).toEqual([]);
    expect(readFileSync(configPath, 'utf8')).toBe(config);
    expect(statSync(configPath).mtimeMs).toBe(before);
  });

  it('removes nothing from a config that is not valid TOML, and says so', () => {
    const config = `[projects.${JSON.stringify(join(tempRoot, 'gone'))}]\ntrust_level = "trusted"\n[broken\n`;
    writeFileSync(configPath, config);

    expect(() => pruneScratchCodexTrust({ configPath, tempRoot })).toThrow(/not valid TOML/);
    expect(readFileSync(configPath, 'utf8')).toBe(config);
  });

  it('has nothing to do without a Codex config', () => {
    expect(pruneScratchCodexTrust({ configPath, tempRoot })).toEqual([]);
  });
});
