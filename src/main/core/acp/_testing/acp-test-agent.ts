import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A small real ACP agent for the suites that start and stop one: a `node`
 * script speaking newline JSON-RPC on stdio. Like opencode, it starts a helper
 * process in its folder that does not hold its stdio, and when its input
 * closes it ends that helper, then itself. It records both pids outside the
 * folder, so a suite can check they are gone.
 *
 * Lives under `_testing/` because vitest excludes `**\/_*\/**` from its test
 * globs, so the file is a helper and never a suite.
 */
export interface AcpTestAgent {
  /** The script to run with `process.execPath`. */
  script: string;
  /** Where the agent writes `{ agent, helper }` pids once it is up. */
  pidFile: string;
}

/** The request the agent answers with a JSON-RPC error instead of a result; null answers all. */
export type AcpTestAgentFailure = 'initialize' | 'session/new' | 'session/set_config_option' | null;

export const ACP_TEST_AGENT_SESSION_ID = 'agent-session-1';

/** The session's model select, as `session/new` reports it: `model-a` current, `model-b` offered. */
export const ACP_TEST_AGENT_MODELS = { current: 'model-a', other: 'model-b' } as const;

const CONFIG_OPTIONS = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: ACP_TEST_AGENT_MODELS.current,
    options: [
      { value: ACP_TEST_AGENT_MODELS.current, name: 'Model A' },
      { value: ACP_TEST_AGENT_MODELS.other, name: 'Model B' },
    ],
  },
];

export function writeAcpTestAgent(
  dir: string,
  name: string,
  failOn: AcpTestAgentFailure
): AcpTestAgent {
  const script = join(dir, `${name}.cjs`);
  const pidFile = join(dir, `${name}.pids.json`);
  writeFileSync(
    script,
    [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ agent: process.pid, helper: helper.pid }));`,
      `const failOn = ${JSON.stringify(failOn)};`,
      'const results = {',
      '  initialize: { protocolVersion: 1, agentCapabilities: {} },',
      `  'session/new': { sessionId: ${JSON.stringify(ACP_TEST_AGENT_SESSION_ID)}, configOptions: ${JSON.stringify(CONFIG_OPTIONS)} },`,
      "  'session/set_config_option': {},",
      '};',
      'const answer = (message) => {',
      '  const body = message.method === failOn',
      '    ? { error: { code: -32603, message: `test agent refused ${message.method}` } }',
      '    : { result: results[message.method] };',
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body }) + '\\n');",
      '};',
      "let buffered = '';",
      "process.stdin.on('data', (chunk) => {",
      '  buffered += chunk;',
      "  const lines = buffered.split('\\n');",
      '  buffered = lines.pop();',
      '  for (const line of lines.filter(Boolean)) answer(JSON.parse(line));',
      '});',
      "process.stdin.on('end', () => { helper.once('exit', () => process.exit(0)); helper.kill(); });",
    ].join('\n')
  );
  return { script, pidFile };
}

export function readAcpTestAgentPids(agent: AcpTestAgent): { agent: number; helper: number } {
  return JSON.parse(readFileSync(agent.pidFile, 'utf-8')) as { agent: number; helper: number };
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
