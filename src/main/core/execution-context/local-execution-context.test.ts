import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { LocalExecutionContext } from './local-execution-context';

/**
 * A command run in a folder that no longer exists fails with ENOENT, which
 * Node words exactly like a missing program ("spawn git ENOENT"). A
 * repository whose folder was deleted read as "git is not installed"
 * (devstation-lq9d). The failure names the folder instead; a program that is
 * really missing still fails as it always did.
 */

const scratch = mkdtempSync(join(tmpdir(), 'chord-exec-root-'));
const gone = join(scratch, 'deleted-repo');

afterAll(() => {
  removeDirSync(scratch);
});

describe('LocalExecutionContext', () => {
  it('names the folder when exec runs in one that does not exist', async () => {
    const ctx = new LocalExecutionContext({ root: gone });

    await expect(ctx.exec(GIT_EXECUTABLE, ['--version'])).rejects.toThrow(
      `The folder ${gone} does not exist`
    );
  });

  it('names the folder when execStreaming runs in one that does not exist', async () => {
    const ctx = new LocalExecutionContext({ root: gone });

    await expect(ctx.execStreaming(GIT_EXECUTABLE, ['--version'], () => true)).rejects.toThrow(
      `The folder ${gone} does not exist`
    );
  });

  it('still fails with ENOENT when the program is missing and the folder exists', async () => {
    const ctx = new LocalExecutionContext({ root: scratch });

    await expect(ctx.exec('chord-no-such-program', [])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('runs a command in a folder that exists', async () => {
    const ctx = new LocalExecutionContext({ root: scratch });

    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['--version']);

    expect(stdout).toMatch(/^git version /);
  });
});
