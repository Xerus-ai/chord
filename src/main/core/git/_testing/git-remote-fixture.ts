import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * A bare remote whose `main` has one commit, the repository that pushed it,
 * and a clone of the remote — the starting point of the suites that test
 * lanes against a real remote.
 *
 * Building it takes ~11 `git` processes. Per test, under the parallel worker
 * pool on Windows, that came to seconds per test (`lane-preflight` 95.8s for
 * 11 tests, devstation-a4d) and blew hook timeouts. It is built once per suite
 * (`createGitRemoteTemplate`) and each test gets a copy of it
 * (`copyGitRemoteFixture`): files only, no process.
 */
export interface GitRemoteFixture {
  root: string;
  /** The bare remote, `main` checked out as HEAD. */
  remoteDir: string;
  /** The repository that made and pushed `main`; its `origin` is the remote. */
  pusherDir: string;
  /** A clone of the remote, with a committer identity. */
  cloneDir: string;
}

const REMOTE = 'remote.git';
const PUSHER = 'pusher';
const CLONE = 'clone';

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function configureIdentity(dir: string): Promise<void> {
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}

/**
 * The remote as `origin` names it: forward slashes, which git accepts on
 * Windows and writes to config unescaped, so a copy can point at its own.
 */
function remoteUrl(remoteDir: string): string {
  return remoteDir.replaceAll(path.sep, '/');
}

function layout(root: string): GitRemoteFixture {
  return {
    root,
    remoteDir: path.join(root, REMOTE),
    pusherDir: path.join(root, PUSHER),
    cloneDir: path.join(root, CLONE),
  };
}

/** Builds the fixture once, in a folder of its own; remove it with `removeGitFixture`. */
export async function createGitRemoteTemplate(): Promise<string> {
  const fixture = layout(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-remote-'))));
  fs.mkdirSync(fixture.remoteDir);
  await git(['init', '--bare'], fixture.remoteDir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], fixture.remoteDir);
  fs.mkdirSync(fixture.pusherDir);
  await git(['init'], fixture.pusherDir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], fixture.pusherDir);
  await configureIdentity(fixture.pusherDir);
  await git(['commit', '--allow-empty', '-m', 'init'], fixture.pusherDir);
  await git(['remote', 'add', 'origin', remoteUrl(fixture.remoteDir)], fixture.pusherDir);
  await git(['push', '-u', 'origin', 'main'], fixture.pusherDir);
  await git(['clone', remoteUrl(fixture.remoteDir), fixture.cloneDir], fixture.root);
  await configureIdentity(fixture.cloneDir);
  return fixture.root;
}

/**
 * A test's own copy of the template. The pusher's and the clone's `origin`
 * are the template's remote by absolute path, so their config is pointed at
 * the copy's remote; nothing else in the fixture names a path.
 */
export function copyGitRemoteFixture(template: string, prefix: string): GitRemoteFixture {
  const fixture = layout(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))));
  fs.cpSync(template, fixture.root, { recursive: true });
  const from = remoteUrl(path.join(template, REMOTE));
  for (const repo of [fixture.pusherDir, fixture.cloneDir]) {
    const configPath = path.join(repo, '.git', 'config');
    const config = fs.readFileSync(configPath, 'utf8');
    const url = `url = ${from}`;
    if (!config.includes(url)) throw new Error(`${configPath} does not name ${from}`);
    fs.writeFileSync(configPath, config.replace(url, `url = ${remoteUrl(fixture.remoteDir)}`));
  }
  return fixture;
}

export function removeGitFixture(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}
