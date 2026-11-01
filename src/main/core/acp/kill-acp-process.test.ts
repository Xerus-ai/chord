import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stopAcpChild } from '@main/core/git-ai/acp-one-shot';
import { killAcpProcess } from './spawn-acp-process';

/**
 * devstation-l9k5: once Node has reported a child's exit it no longer holds the process
 * handle, so Windows may hand that pid to another process and `taskkill /T` would end that
 * process's tree. A child that already exited is not killed by pid. Real child processes.
 */
function spawnNode(script: string): ChildProcess {
  return spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
}

function exitOf(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

describe('killAcpProcess', () => {
  it('ends nothing for a child Node has seen exit', async () => {
    const child = spawnNode('process.exit(0)');
    await exitOf(child);

    expect(killAcpProcess(child)).toBe('exited');
  });

  it("ends a running child's tree", async () => {
    const child = spawnNode('setInterval(() => {}, 1000)');
    const exited = exitOf(child);

    expect(killAcpProcess(child)).toBe(process.platform === 'win32' ? 'tree' : 'signal');

    await exited;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});

describe('stopAcpChild (the git-ai one-shot stop)', () => {
  it('resolves for a child that already exited without killing by pid', async () => {
    const child = spawnNode('process.exit(0)');
    await exitOf(child);

    expect(await stopAcpChild(child)).toBe('exited');
  });

  it('ends a running child and resolves once it has exited', async () => {
    const child = spawnNode('setInterval(() => {}, 1000)');

    expect(await stopAcpChild(child)).not.toBe('exited');
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
