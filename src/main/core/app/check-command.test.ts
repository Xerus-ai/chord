import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCommand } from './check-command';

/**
 * "Open in" lists an editor only when its command is installed. The check ran
 * `command -v <cmd>` through the platform shell — on Windows that is cmd.exe,
 * which has no `command`, so every editor detected that way (VS Code, Cursor,
 * Windsurf, the JetBrains IDEs) read as missing, after one spawn per command
 * (measured 2026-10-15: 17 spawns, ~160 ms of main thread). It reads PATH now.
 */
let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chord-check-command-'));
  savedPath = process.env.PATH;
});

afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

/** A launcher the platform runs by bare name: `<name>.cmd` on Windows, an executable elsewhere. */
function installLauncher(name: string): void {
  const file = process.platform === 'win32' ? `${name}.cmd` : name;
  writeFileSync(join(dir, file), '', { mode: 0o755 });
}

describe('checkCommand', () => {
  it('finds a command installed on PATH', async () => {
    installLauncher('chord-test-editor');
    process.env.PATH = `${dir}${delimiter}${savedPath ?? ''}`;

    expect(await checkCommand('chord-test-editor')).toBe(true);
  });

  it('reports a command on no PATH directory as missing', async () => {
    process.env.PATH = dir;

    expect(await checkCommand('chord-test-editor-absent')).toBe(false);
  });
});
