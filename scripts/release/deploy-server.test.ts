import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * scripts/release/deploy-server.sh, release.yml's server deploy (devstation-pqub; the box side
 * is server/deploy/deploy.sh, devstation-5s42). It sends `git archive <tag>` to the deploy key's
 * forced command and reads deploy.sh's exit: 0 live, 1 failed (the release fails and its update
 * manifests stay unpublished), 2 refused, 75 another deploy holds the lock (retried, then a
 * failure, never a pass). DEPLOY_SSH stands in for the `ssh` call with a real script playing
 * the box's exits; the host key checks and the exit handling under test are the script's own.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'deploy-server.sh');

/** Git Bash on Windows (a bare bash.exe on PATH is usually WSL's); bash elsewhere. */
function bashPath(): string {
  if (process.platform !== 'win32') return 'bash';
  const git = execFileSync('where', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  for (let dir = dirname(git); dir !== dirname(dir); dir = dirname(dir)) {
    const bash = join(dir, 'bin', 'bash.exe');
    if (existsSync(bash)) return bash;
  }
  throw new Error(`no Git Bash next to ${git}`);
}
const BASH = bashPath();
const posix = (path: string) => path.replace(/\\/g, '/');

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A repo with one commit tagged v1.2.0; returns it and the tag's commit. */
function createTaggedRepo() {
  const repo = temp('deploy-server-repo-');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Deploy Test');
  git('config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'release-marker.txt'), 'the tagged tree\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore(release): v1.2.0 (t-1)');
  git('tag', '-a', 'v1.2.0', '-m', 'v1.2.0');
  return { repo, sha: git('rev-parse', 'HEAD') };
}

/**
 * The box: answers each deploy with the next exit in `exits`, recording its arguments and the
 * names in the tar it was sent.
 */
function createBox(exits: number[]) {
  const dir = temp('deploy-server-box-');
  writeFileSync(join(dir, 'exits'), exits.join('\n') + '\n');
  const box = join(dir, 'box.sh');
  writeFileSync(
    box,
    [
      '#!/usr/bin/env bash',
      `d='${posix(dir)}'`,
      'echo "$*" >>"$d/requests"',
      'tar -t >>"$d/received"',
      'code=$(head -n1 "$d/exits"); sed -i 1d "$d/exits"',
      'echo "deploy: the box answers $code"',
      'exit "$code"',
      '',
    ].join('\n')
  );
  return {
    command: `bash '${posix(box)}'`,
    requests: () => readFileSync(join(dir, 'requests'), 'utf8').trim().split('\n'),
    received: () => readFileSync(join(dir, 'received'), 'utf8'),
  };
}

function runDeploy(opts: { exits: number[]; knownHosts?: string; key?: string }) {
  const { repo, sha } = createTaggedRepo();
  const box = createBox(opts.exits);
  const secrets = temp('deploy-server-secrets-');
  const knownHosts = join(secrets, 'known_hosts');
  const key = join(secrets, 'key');
  writeFileSync(
    knownHosts,
    opts.knownHosts ?? 'chord-sync-1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n'
  );
  writeFileSync(key, opts.key ?? '-----BEGIN OPENSSH PRIVATE KEY-----\n');
  const result = spawnSync(BASH, [posix(SCRIPT), 'v1.2.0', sha], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOY_HOST: 'chord-sync-1',
      DEPLOY_KEY_FILE: posix(key),
      DEPLOY_KNOWN_HOSTS_FILE: posix(knownHosts),
      DEPLOY_SSH: box.command,
      DEPLOY_RETRY_DELAY: '0',
    },
  });
  return { ...result, box, sha };
}

describe('deploy-server.sh', () => {
  it('sends the tag as a tar with `deploy <tag> <sha>` and passes when deploy.sh exits 0', () => {
    const run = runDeploy({ exits: [0] });

    expect(run.status).toBe(0);
    expect(run.box.requests()).toEqual([`deploy v1.2.0 ${run.sha}`]);
    expect(run.box.received()).toContain('release-marker.txt');
    expect(run.stdout).toContain('deploy: the box answers 0');
  });

  it('fails the release when deploy.sh exits 1, saying the manifests stay unpublished', () => {
    const run = runDeploy({ exits: [1] });

    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).toMatch(/manifests stay unpublished/);
    expect(run.box.requests()).toHaveLength(1);
  });

  it('retries while another deploy holds the lock (75), then passes', () => {
    const run = runDeploy({ exits: [75, 75, 0] });

    expect(run.status).toBe(0);
    expect(run.box.requests()).toHaveLength(3);
  });

  it('fails, never passes, when the lock is held on every try', () => {
    const run = runDeploy({ exits: [75, 75, 75, 75, 75, 75, 75] });

    expect(run.status).toBe(1);
    expect(run.box.requests()).toHaveLength(5);
    expect(run.stdout + run.stderr).toMatch(/lock/);
  });

  it('fails on a refused request (2), without retrying', () => {
    const run = runDeploy({ exits: [2, 0] });

    expect(run.status).toBe(1);
    expect(run.box.requests()).toHaveLength(1);
  });

  it('refuses to connect without a pinned host key, before anything is sent', () => {
    const run = runDeploy({ exits: [0], knownHosts: '' });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/HETZNER_KNOWN_HOSTS/);
    expect(existsSync(join(dirname(run.box.command.slice(6, -1)), 'requests'))).toBe(false);
  });

  it('connects with the pinned host key only: StrictHostKeyChecking=yes, never accept-new', () => {
    const text = readFileSync(SCRIPT, 'utf8');

    expect(text).toMatch(/StrictHostKeyChecking=yes/);
    expect(text).toMatch(/UserKnownHostsFile=/);
    expect(text).not.toMatch(/accept-new|StrictHostKeyChecking=no/);
  });
});
