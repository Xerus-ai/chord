import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { GitHubAuthExecutionContext } from './github-auth-execution-context';
import { LocalExecutionContext } from './local-execution-context';

const TOKEN = 'gho_testTokenThatMustNeverBeShown';
const ENCODED = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');

function authContext(root: string, token: string | null = TOKEN): GitHubAuthExecutionContext {
  return new GitHubAuthExecutionContext(new LocalExecutionContext({ root }), async () => token);
}

/** Values git received for `key` from this command alone (not from any config file). */
async function commandScopeValues(ctx: GitHubAuthExecutionContext, key: string): Promise<string[]> {
  const { stdout } = await ctx
    .exec(GIT_EXECUTABLE, ['config', '--show-scope', '--get-all', key])
    .catch((error: { code?: number }) => {
      // Exit 1 = the key is set nowhere.
      if (error.code === 1) return { stdout: '' };
      throw error;
    });
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('command\t'))
    .map((line) => line.slice('command\t'.length).trim());
}

async function captureFailure(run: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run;
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error('expected the command to fail');
}

/**
 * Git runs with the user's GitHub token so fetches of private repositories
 * work. The token must reach git and nothing else: a failed command's error
 * is shown in the app and stored on the work item.
 */
describe('GitHubAuthExecutionContext', () => {
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-auth-ctx-'));
    await new LocalExecutionContext({ root }).exec(GIT_EXECUTABLE, ['init']);
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it('keeps the token out of a failed git command’s error', async () => {
    const failure = await captureFailure(
      authContext(root).exec(GIT_EXECUTABLE, ['fetch', path.join(root, 'missing.git'), 'main'])
    );

    const shown = [failure.message, failure.cmd, failure.stderr, failure.stdout].join('\n');
    expect(shown).toContain('missing.git');
    expect(shown).not.toContain(ENCODED);
    expect(shown).not.toContain(TOKEN);
  });

  it('hands git the GitHub authorization header', async () => {
    expect(
      await commandScopeValues(authContext(root), 'http.https://github.com/.extraHeader')
    ).toEqual([`Authorization: Basic ${ENCODED}`]);
  });

  it('rewrites GitHub SSH remotes to HTTPS for network commands', async () => {
    const ctx = authContext(root);

    for (const remote of [
      'git@github.com:acme/app.git',
      'ssh://git@github.com:acme/app.git',
      'ssh://git@github.com/acme/app.git',
    ]) {
      const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['ls-remote', '--get-url', remote]);
      expect(stdout.trim()).toBe('https://github.com/acme/app.git');
    }
  });

  it('leaves remotes alone for local commands', async () => {
    expect(
      await commandScopeValues(authContext(root), 'url.https://github.com/.insteadOf')
    ).toEqual([]);
  });

  it('runs git without auth when there is no token', async () => {
    expect(
      await commandScopeValues(authContext(root, null), 'http.https://github.com/.extraHeader')
    ).toEqual([]);
  });
});
