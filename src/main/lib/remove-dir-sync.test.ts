import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeDirSync } from './remove-dir-sync';

/**
 * Test cleanup waits out a process still sitting in its folder
 * (devstation-uag): rmSync's maxRetries threw EPERM at once there.
 * A real child process holds a real folder.
 */
function holdFolder(dir: string, ms: number) {
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { cwd: dir });
  return new Promise<void>((resolve) => setTimeout(resolve, 300)).then(() => ({
    exited: new Promise<void>((resolve) => child.on('exit', () => resolve())),
  }));
}

describe('removeDirSync', () => {
  it.runIf(process.platform === 'win32')(
    'removes a folder once the process sitting in it lets go',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'chord-remove-dir-'));
      writeFileSync(join(dir, 'file.txt'), 'x');
      const { exited } = await holdFolder(dir, 1200);

      expect(() => rmSync(dir, { recursive: true, maxRetries: 5, retryDelay: 100 })).toThrow(
        /EPERM|EBUSY/
      );
      removeDirSync(dir);

      expect(existsSync(dir)).toBe(false);
      await exited;
    }
  );

  it('gives up with the last error when the folder stays held', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chord-remove-dir-'));
    const { exited } = await holdFolder(dir, 3000);

    if (process.platform === 'win32') {
      expect(() => removeDirSync(dir, { attempts: 2, delayMs: 50 })).toThrow(/EPERM|EBUSY/);
    }
    await exited;
    removeDirSync(dir);
    expect(existsSync(dir)).toBe(false);
  });
});
