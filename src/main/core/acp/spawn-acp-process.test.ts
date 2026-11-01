import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { spawnAcpProcess, stopAcpProcess, type AcpProcess } from './spawn-acp-process';

/**
 * Stopping a short-lived ACP agent (session listing and loading) leaves its
 * folder free: a lane Delete right after a listing hit EPERM on Windows while
 * the agent, or a process it started in the lane, was still going. Real
 * processes — `node` running small agent scripts — in a real folder, removed
 * without retries the moment the stop resolves.
 */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-acp-stop-')));

/**
 * Every agent a test started, reaped after it whatever the code under test
 * did: a failing stop (a red run) otherwise leaves the agent running after the
 * suite, as three stubborn agents were for ten hours (devstation-tcl).
 */
const started: AcpProcess[] = [];

afterEach(async () => {
  for (const { child, closed } of started.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
    await closed;
  }
});

afterAll(() => {
  removeDirSync(root);
});

/** An agent that says it is ready once `setup` has run, then does what `onInputEnd` says. */
function writeAgent(name: string, setup: string, onInputEnd: string): string {
  const file = join(root, `${name}.cjs`);
  writeFileSync(
    file,
    [
      "const { spawn } = require('node:child_process');",
      setup,
      "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'ready' }) + '\\n');",
      `process.stdin.on('end', () => { ${onInputEnd} });`,
      'process.stdin.resume();',
    ].join('\n')
  );
  return file;
}

function makeLane(name: string): string {
  const lane = join(root, name);
  mkdirSync(lane);
  return lane;
}

async function startAgent(script: string, lane: string) {
  const agent = await spawnAcpProcess({ command: process.execPath, args: [script], cwd: lane });
  started.push(agent);
  const reader = agent.stream.readable.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  expect(value).toMatchObject({ method: 'ready' });
  return agent;
}

describe('stopAcpProcess', () => {
  it('resolves once the agent and what it started in the folder are gone', async () => {
    // Like opencode: a helper in the listed folder that does not hold the
    // agent's stdio, ended by the agent itself when its input closes.
    const script = writeAgent(
      'tidy-agent',
      "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      "helper.once('exit', () => process.exit(0)); helper.kill();"
    );
    const lane = makeLane('tidy-lane');
    const { child, closed } = await startAgent(script, lane);

    await stopAcpProcess(child, closed);

    rmSync(lane, { recursive: true });
    expect(existsSync(lane)).toBe(false);
  });

  it('kills an agent that keeps running after its input closes, and waits for it', async () => {
    const script = writeAgent('stubborn-agent', 'setInterval(() => {}, 1000);', '');
    const lane = makeLane('stubborn-lane');
    const { child, closed } = await startAgent(script, lane);

    await stopAcpProcess(child, closed);

    rmSync(lane, { recursive: true });
    expect(existsSync(lane)).toBe(false);
  });
});
