/**
 * Drives a REAL ACP agent through Chord's own ACP client
 * (src/main/core/acp/acp-sdk-client.ts, bundled here for Node — it has no
 * Electron dependency) against a running Chord's chord MCP endpoint.
 *
 * The client sends `initialize`, then `session/new` with the chord server in
 * the transport under test, then one prompt asking the agent to call
 * `list_artifacts`. Returns what happened, for the caller to assert on.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import { ROOT } from './seeded-app.mjs';

const ACP_BRIDGE = '@agentclientprotocol/claude-agent-acp@0.33.1';

function resolveClaudeExecutable() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const found = execFileSync(finder, ['claude'], { encoding: 'utf-8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const executable = found.find((p) => /\.exe$/i.test(p)) ?? found[0];
  if (!executable) throw new Error('Claude Code is not installed (claude not on PATH)');
  return executable;
}

async function loadAcpClient() {
  const outDir = mkdtempSync(join(tmpdir(), 'chord-acp-probe-'));
  const outfile = join(outDir, 'acp-sdk-client.cjs');
  await esbuild.build({
    entryPoints: [join(ROOT, 'src', 'main', 'core', 'acp', 'acp-sdk-client.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'error',
    tsconfig: join(ROOT, 'tsconfig.json'),
    // The shared logger reads Vite's `import.meta.env`, which Node lacks.
    define: { 'import.meta.env': '{}' },
  });
  const module = createRequire(import.meta.url)(outfile);
  return { AcpSDKClient: module.AcpSDKClient, cleanup: () => rmSync(outDir, { recursive: true }) };
}

/**
 * @param {{
 *   cwd: string,
 *   serverFor: (transport: { http: boolean }) => object,
 *   timeoutMs?: number,
 * }} options  `serverFor` builds the chord `session/new` entry from what the
 *   agent advertised in `initialize`.
 */
export async function probeAcpChordTools({ cwd, serverFor, timeoutMs = 240_000 }) {
  const { AcpSDKClient, cleanup } = await loadAcpClient();
  const toolCalls = new Map();
  let advertisedHttp = null;
  let exitCode = null;
  const client = new AcpSDKClient({
    command: 'npx',
    args: ['--prefer-offline', '--yes', ACP_BRIDGE],
    cwd,
    // The bridge runs the user's installed Claude Code, not a bundled binary.
    env: { CLAUDE_CODE_EXECUTABLE: resolveClaudeExecutable() },
    mcpServers: (transport) => {
      advertisedHttp = transport.http;
      return [serverFor(transport)];
    },
    onSessionUpdate: (update) => {
      if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
        return;
      }
      const previous = toolCalls.get(update.toolCallId) ?? {};
      toolCalls.set(update.toolCallId, { ...previous, ...update });
    },
    onPermissionRequest: () => {},
    onError: (e) => console.error('acp probe error:', e.message),
    onExit: (code) => {
      exitCode = code;
    },
  });

  try {
    await client.start();
    const prompt = client.sendPrompt(
      'This is an automated test of Chord. Call the chord list_artifacts MCP tool exactly once, then reply with the single word DONE.'
    );
    await Promise.race([
      prompt,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`ACP turn timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  } finally {
    client.kill();
    cleanup();
  }

  const calls = [...toolCalls.values()];
  const listCall = calls.find((c) =>
    JSON.stringify([c.title, c.rawInput, c._meta]).includes('list_artifacts')
  );
  return { advertisedHttp, exitCode, listCall, calls };
}
