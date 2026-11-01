import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readGitFailureOutput } from './git-failure-output';

const execFileAsync = promisify(execFile);

/** The rejection a failed command gives, as `IExecutionContext.exec` passes it on. */
async function failureOf(file: string, args: string[], timeout?: number): Promise<unknown> {
  try {
    await execFileAsync(file, args, { timeout });
  } catch (error) {
    return error;
  }
  throw new Error(`${file} ${args.join(' ')} did not fail`);
}

/**
 * What git said when a command failed, kept apart from the sentence the user
 * reads (devstation-kcvy): its stderr, not Node's "Command failed: git …"
 * preamble with the whole command line.
 */
describe('readGitFailureOutput', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) removeDirSync(dir);
    dir = null;
  });

  it("is git's own stderr, without the command line Node puts before it", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-failure-output-'));
    const missing = path.join(dir, 'origin.git');

    const output = readGitFailureOutput(
      await failureOf('git', ['ls-remote', '--exit-code', missing, 'refs/heads/main'])
    );

    expect(output).toMatch(/^fatal: /);
    expect(output).toContain('origin.git');
    expect(output).not.toMatch(/Command failed/);
    expect(output).toBe(output.trim());
  });

  it('says the command was stopped when its timeout killed it before it printed anything', async () => {
    const output = readGitFailureOutput(
      await failureOf(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 200)
    );

    expect(output).toBe('Stopped by its timeout before it answered.');
  });
});
