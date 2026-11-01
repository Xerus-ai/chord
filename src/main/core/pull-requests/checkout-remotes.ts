import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseGitHubRepository } from '@shared/github-repository';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;

export interface CheckoutRemotes {
  /** Every remote name, as `git remote` lists them. */
  names: string[];
  /** The GitHub repository the checkout pushes to — `origin` first — or null when none is GitHub. */
  repositoryUrl: string | null;
}

/**
 * The lane PR reads run on 5–15s polls, and the remotes behind them almost
 * never change. They are read from git once per clone, and again only when
 * the clone's shared config file changes: every worktree of a clone shares
 * `<common dir>/config`, which is where `git remote add` / `set-url` write.
 */
const configPathByCheckout = new Map<string, string>();
const remotesByConfig = new Map<
  string,
  { mtimeMs: number; size: number; remotes: CheckoutRemotes }
>();

async function git(checkoutPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GIT_EXECUTABLE, args, {
    cwd: checkoutPath,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout.trim();
}

/** `<common dir>/config` for a checkout — read from git once per path: it never moves. */
async function resolveCommonConfigPath(checkoutPath: string): Promise<string> {
  const known = configPathByCheckout.get(checkoutPath);
  if (known) return known;
  const commonDir = await git(checkoutPath, ['rev-parse', '--git-common-dir']);
  const configPath = path.join(path.resolve(checkoutPath, commonDir), 'config');
  configPathByCheckout.set(checkoutPath, configPath);
  return configPath;
}

/** A remote's configured URL, or null when it has none (git exits 1 for an unset key). */
async function readRemoteUrl(checkoutPath: string, remote: string): Promise<string | null> {
  try {
    return await git(checkoutPath, ['config', '--get', `remote.${remote}.url`]);
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return null;
    throw error;
  }
}

/**
 * The configured URL is read (`remote.<name>.url`), not the one `insteadOf`
 * rewrites it to: that is the repository GitHub reports as a PR's head.
 * `origin` is tried first, then any other remote, so a checkout whose GitHub
 * remote has another name resolves.
 */
async function readRemotesFromGit(checkoutPath: string): Promise<CheckoutRemotes> {
  const names = (await git(checkoutPath, ['remote']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const ordered = [...names].sort((a, b) => Number(b === 'origin') - Number(a === 'origin'));
  for (const name of ordered) {
    const repository = parseGitHubRepository(await readRemoteUrl(checkoutPath, name));
    if (repository) return { names, repositoryUrl: repository.repositoryUrl };
  }
  return { names, repositoryUrl: null };
}

/**
 * The checkout's remotes and its GitHub repository. A stat of the shared
 * config file decides whether the last read still holds; git runs only when
 * that file's mtime or size moved.
 */
export async function readCheckoutRemotes(checkoutPath: string): Promise<CheckoutRemotes> {
  const configPath = await resolveCommonConfigPath(checkoutPath);
  const { mtimeMs, size } = await stat(configPath);
  const cached = remotesByConfig.get(configPath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.remotes;
  const remotes = await readRemotesFromGit(checkoutPath);
  remotesByConfig.set(configPath, { mtimeMs, size, remotes });
  return remotes;
}
