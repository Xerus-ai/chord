import { rmSync } from 'node:fs';

/** Errors a folder gives while a process is still letting go of it (Windows). */
const STILL_HELD = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);

/**
 * Removes a test's temporary folder, waiting out a process that is still
 * letting go of it. `rmSync`'s `maxRetries` does not retry EPERM: on Node
 * 24.15 it threw at 0 ms on a folder another process sat in, while `fs.rm`
 * waited it out (devstation-uag, probe chord-lane-checks/probe-uag). Test
 * hooks here are synchronous, so this retries itself, blocking between
 * tries, and throws the last error once `attempts` are spent.
 */
export function removeDirSync(dir: string, { attempts = 25, delayMs = 200 } = {}): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !STILL_HELD.has(code) || attempt >= attempts) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}
