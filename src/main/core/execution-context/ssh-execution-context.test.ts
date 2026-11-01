import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { buildSshCommand, buildSshInvocation, type SshInvocation } from './ssh-execution-context';

const SECRET = `Authorization: Basic eC1hY2Nlc3MtdG9rZW46Z2hv'quote"dq$dollar\\back`;

/**
 * A POSIX bash to stand in for the remote host's shell. On Windows `bash` on
 * PATH is often WSL's launcher, so use the one Git for Windows ships.
 */
function posixBash(): string {
  if (process.platform !== 'win32') return 'bash';
  const execPath = execFileSync(GIT_EXECUTABLE, ['--exec-path'], { encoding: 'utf8' }).trim();
  // <git>/mingw64/libexec/git-core → <git>/bin/bash.exe
  return path.join(execPath, '..', '..', '..', 'bin', 'bash.exe');
}

/** Runs what SSH would run, feeding `stdin` the way the channel does, and returns stdout's last line. */
function runAsRemote(invocation: SshInvocation): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(posixBash(), ['-c', invocation.command], { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`exit ${code}: ${stderr}`));
      resolve(stdout.trim().split(/\r?\n/).pop() ?? '');
    });
    child.stdin.end(invocation.stdin ?? undefined);
  });
}

/**
 * Commands over SSH run in a `bash -l -c '…'` command line that the remote
 * host shows every user in its process list, so environment values — the
 * GitHub token among them — must reach the command some other way.
 */
describe('buildSshInvocation', () => {
  it('keeps env values out of the command line and hands them to the command', async () => {
    const invocation = buildSshInvocation(undefined, 'printenv', ['GIT_CONFIG_VALUE_0'], {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
      GIT_CONFIG_VALUE_0: SECRET,
    });

    expect(invocation.command).not.toContain('eC1hY2Nlc3M');
    expect(await runAsRemote(invocation)).toBe(SECRET);
  });

  it('runs in the root directory with the env set', async () => {
    const root = process.platform === 'win32' ? '/tmp' : '/';
    const invocation = buildSshInvocation(root, 'sh', ['-c', 'echo "$PWD|$TOKEN_A"'], {
      TOKEN_A: 'a b',
    });

    expect(await runAsRemote(invocation)).toBe(`${root}|a b`);
  });

  it('is the plain command, with nothing on stdin, when there is no env', () => {
    expect(buildSshInvocation('/repo', 'git', ['status'])).toEqual({
      command: buildSshCommand('/repo', 'git', ['status']),
      stdin: null,
    });
  });

  it('refuses a name that is not an environment variable name', () => {
    expect(() => buildSshInvocation(undefined, 'git', [], { 'BAD NAME': 'x' })).toThrow(
      /Invalid environment variable name/
    );
  });

  it('refuses a value with a line break, which would end its line early', () => {
    expect(() => buildSshInvocation(undefined, 'git', [], { A: 'one\ntwo' })).toThrow(/line break/);
  });
});
