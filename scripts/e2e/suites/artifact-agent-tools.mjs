#!/usr/bin/env node
/**
 * P3 done-check, run against a PACKAGED build (plan 2026-09-23 §4 P3).
 *
 *   node scripts/e2e/suites/artifact-agent-tools.mjs [path/to/Chord.exe]
 *
 * Drives real agents (the user's own Codex and Claude logins) and asserts:
 *
 *   1. Codex (app-server chat) publishes plan.md with the chord tool → the
 *      artifact exists and the turn carries its card
 *   2. a Claude terminal session is launched with Chord's MCP config and
 *      settings files, and that exact launch lists mcp__chord__publish_artifact
 *      and no built-in Artifact tool; a plain `claude` outside Chord keeps
 *      whatever the user's own settings give it
 *   3. the loopback endpoint refuses a missing or unknown token
 *   4. the stdio shim, run by the packaged Chord.exe in Node mode, serves the
 *      chord tools to a real MCP client
 *   5. a real ACP agent, through Chord's ACP client, calls a chord tool over
 *      the transport it advertises (HTTP), and over the stdio shim
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { probeAcpChordTools } from '../lib/acp-chord-probe.mjs';
import { launchSeededApp } from '../lib/seeded-app.mjs';

const FIXTURE_DIR = '.chord-p3-fixtures';
const TURN_TIMEOUT_MS = 5 * 60_000;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const { page, rpc, readStdout, executablePath, profileDir, close } = await launchSeededApp({
  exe: process.argv[2],
  profilePrefix: 'chord-p3-e2e',
  env: { LOG_LEVEL: 'info' },
});

async function call(channel, ...args) {
  const res = await rpc(channel, ...args);
  if (!res?.success) throw new Error(`${channel} failed: ${JSON.stringify(res)}`);
  return res.data;
}

/** Sends one prompt and waits for the turn, answering permission cards with allow-once. */
async function runTurn(workItemId, sessionId, providerId, content) {
  const sentAt = Math.floor(Date.now() / 1000);
  await call('chatMessages.sendToAgent', {
    workItemId,
    sessionId,
    content,
    agentProviderId: providerId,
  });
  const answered = new Set();
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { turns } = await call('chatMessages.getTimelineTurns', { workItemId, sessionId });
    for (const item of turns.flatMap((t) => t.items)) {
      if (item.kind !== 'permission' || item.resolved || answered.has(item.requestId)) continue;
      answered.add(item.requestId);
      // Option ids are the agent's own (Codex: `accept`); the kind is shared.
      const allowOnce = item.options.find((o) => o.kind === 'allow_once');
      if (!allowOnce) throw new Error(`No allow-once option: ${JSON.stringify(item.options)}`);
      await call('acp.respondToPermission', {
        workItemId,
        requestId: item.requestId,
        optionId: allowOnce.optionId,
      });
    }
    const streaming = turns.some((t) => t.status === 'streaming');
    const done = turns.filter((t) => t.status === 'complete' && t.timestamp >= sentAt);
    if (!streaming && done.length > 0) return done.flatMap((t) => t.items);
    await page.waitForTimeout(1000);
  }
  throw new Error(`Turn did not complete within ${TURN_TIMEOUT_MS / 1000}s`);
}

async function waitForFile(path, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`File never appeared: ${path}`);
    await page.waitForTimeout(250);
  }
}

/**
 * Runs `claude -p` with stream-json output; returns its init event and every
 * event. Spawned without a shell, so argv reaches the CLI as given — the
 * Claude Code install is a native executable found on PATH.
 */
function runClaudePrint(cwd, args, prompt) {
  const result = spawnSync(
    'claude',
    ['-p', '--output-format', 'stream-json', '--verbose', ...args, prompt],
    { cwd, encoding: 'utf-8', timeout: 240_000 }
  );
  if (result.error) throw result.error;
  const events = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  return { init, events, stderr: result.stderr, status: result.status };
}

let fixtureRoot = null;
try {
  const { items } = await call('workItems.getAll');
  const workItem = items.find((w) => w.repoPath && existsSync(w.repoPath));
  if (!workItem) throw new Error('Seed profile has no work item with an existing repoPath');
  // The update takes the whole value; keep the fields this check does not set.
  await rpc('appSettings.update', 'artifacts', {
    ...(await rpc('appSettings.get', 'artifacts')),
    enabled: true,
    preferredFormat: 'best-fit',
  });

  // ── 1: Codex publishes through the loopback endpoint ──────────────────
  const { session: codexSession } = await call('agentSessions.create', {
    workItemId: workItem.id,
    kind: 'chat',
    agentProviderId: 'codex',
    communication: 'acp',
  });
  fixtureRoot = join(codexSession.cwd, FIXTURE_DIR);
  mkdirSync(fixtureRoot, { recursive: true });
  const planPath = join(fixtureRoot, 'codex-plan.md');
  const codexItems = await runTurn(
    workItem.id,
    codexSession.id,
    'codex',
    [
      'This is an automated test of Chord. Do exactly these steps and nothing else:',
      `1. Write the file ${FIXTURE_DIR}/codex-plan.md containing "# P3 plan" and one sentence.`,
      `2. Call the chord MCP tool publish_artifact with path "${FIXTURE_DIR}/codex-plan.md".`,
      '3. Reply with the JSON the tool returned.',
    ].join('\n')
  );
  const { artifacts } = await call('artifacts.listByWorkItem', workItem.id);
  check(
    'Codex publishes codex-plan.md through the chord tool',
    artifacts.some((a) => a.filePath === planPath),
    planPath
  );
  check(
    'the Codex turn carries the artifact card',
    codexItems.some((i) => i.kind === 'artifact' && i.filePath === planPath)
  );
  // What the turn did, so a failure above says why.
  const codexTools = codexItems
    .filter((i) => i.kind === 'tool_group')
    .flatMap((g) => g.tools)
    .map((t) => `${t.name}:${t.status ?? ''}`);
  const codexText = codexItems
    .filter((i) => i.kind === 'text')
    .map((i) => i.text)
    .join(' ');
  console.log(`INFO  codex tools: ${codexTools.join(', ') || 'none'}`);
  console.log(`INFO  codex reply: ${codexText.slice(0, 400)}`);
  const codexLog = readStdout()
    .split(/\r?\n/)
    .filter((l) => /chord-mcp|mcp_servers|codex app-server: stderr/i.test(l))
    .slice(-15);
  console.log(`INFO  main log:\n${codexLog.join('\n')}`);

  // ── 2: a Claude terminal gets the chord tools and no built-in Artifact ─
  const { session: terminalSession } = await call('agentSessions.createTerminal', {
    workItemId: workItem.id,
    agentProviderId: 'claude',
  });
  const terminalId = terminalSession.id;
  const mcpConfigPath = join(profileDir, 'chord-mcp', `${terminalId}.mcp.json`);
  const settingsPath = join(profileDir, 'chord-mcp', `${terminalId}.settings.json`);
  await waitForFile(mcpConfigPath);
  const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
  const chordServer = mcpConfig.mcpServers?.chord;
  const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  check(
    'the terminal launch carries an HTTP chord server with a bearer token',
    chordServer?.type === 'http' &&
      /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(chordServer.url) &&
      /^Bearer [0-9a-f-]{36}$/.test(chordServer.headers?.Authorization ?? ''),
    chordServer?.url
  );
  check(
    'the terminal launch turns the built-in Artifact tool off',
    settings.enableArtifact === false
  );

  const inChord = runClaudePrint(
    fixtureRoot,
    ['--mcp-config', mcpConfigPath, '--settings', settingsPath],
    'Reply with the single word OK.'
  );
  const chordTools = inChord.init?.tools ?? [];
  check(
    'that launch lists mcp__chord__publish_artifact and no built-in Artifact tool',
    chordTools.includes('mcp__chord__publish_artifact') &&
      !chordTools.some((t) => t.toLowerCase() === 'artifact'),
    chordTools.filter((t) => t.startsWith('mcp__chord') || /artifact/i.test(t)).join(', ')
  );
  const plain = runClaudePrint(fixtureRoot, [], 'Reply with the single word OK.');
  const plainTools = plain.init?.tools ?? [];
  console.log(
    `INFO  plain claude outside Chord: built-in Artifact tool ${
      plainTools.some((t) => t.toLowerCase() === 'artifact') ? 'present' : 'absent'
    }, chord tools ${plainTools.some((t) => t.startsWith('mcp__chord')) ? 'present' : 'absent'}`
  );
  check(
    'a plain claude outside Chord has no chord tools',
    plain.init !== undefined && !plainTools.some((t) => t.startsWith('mcp__chord'))
  );

  // ── 3: the endpoint refuses callers without the session's token ──────
  const probe = (headers) =>
    fetch(chordServer.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
  const noToken = await probe({});
  const badToken = await probe({ Authorization: 'Bearer 00000000-0000-0000-0000-000000000000' });
  check(
    'the endpoint refuses a missing or unknown token',
    noToken.status === 401 && badToken.status === 401,
    `${noToken.status}/${badToken.status}`
  );

  // ── 4: the stdio shim under the packaged executable ───────────────────
  const token = chordServer.headers.Authorization.slice('Bearer '.length);
  const shimPath = join(
    dirname(executablePath),
    'resources',
    'app.asar.unpacked',
    'out',
    'chord-mcp',
    'chord-mcp-stdio.cjs'
  );
  const stdioConfigPath = join(fixtureRoot, 'stdio.mcp.json');
  writeFileSync(
    stdioConfigPath,
    JSON.stringify({
      mcpServers: {
        chord: {
          command: executablePath,
          args: [shimPath],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            CHORD_MCP_URL: chordServer.url,
            CHORD_MCP_TOKEN: token,
          },
        },
      },
    })
  );
  const viaShim = runClaudePrint(
    fixtureRoot,
    ['--mcp-config', stdioConfigPath, '--allowedTools=mcp__chord__list_artifacts'],
    'Call the mcp__chord__list_artifacts tool once, then reply with the single word DONE.'
  );
  const shimServer = viaShim.init?.mcp_servers?.find((s) => s.name === 'chord');
  const toolUse = viaShim.events
    .flatMap((e) => (e.type === 'assistant' ? e.message.content : []))
    .find((c) => c.type === 'tool_use' && c.name === 'mcp__chord__list_artifacts');
  const toolResult = viaShim.events
    .flatMap((e) => (e.type === 'user' ? e.message.content : []))
    .find((c) => c.type === 'tool_result' && c.tool_use_id === toolUse?.id);
  check(
    'the stdio shim run by Chord.exe serves the chord tools to a real client',
    shimServer?.status === 'connected' && !!toolResult && !toolResult.is_error,
    `server=${shimServer?.status} result=${JSON.stringify(toolResult?.content ?? null).slice(0, 160)}`
  );

  // ── 5: a real ACP agent through Chord's ACP client ────────────────────
  // The same two entries agent-artifact-tools/chord-mcp-access.ts builds.
  const stdioEntry = {
    name: 'chord',
    command: executablePath,
    args: [shimPath],
    env: [
      { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
      { name: 'CHORD_MCP_URL', value: chordServer.url },
      { name: 'CHORD_MCP_TOKEN', value: token },
    ],
  };
  const httpEntry = {
    type: 'http',
    name: 'chord',
    url: chordServer.url,
    headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
  };
  const httpRun = await probeAcpChordTools({
    cwd: fixtureRoot,
    serverFor: (transport) => (transport.http ? httpEntry : stdioEntry),
  });
  check(
    'ACP: the agent advertises HTTP in initialize and calls a chord tool over it',
    httpRun.advertisedHttp === true && httpRun.listCall?.status === 'completed',
    `http=${httpRun.advertisedHttp} status=${httpRun.listCall?.status} calls=${httpRun.calls.length}`
  );
  const stdioRun = await probeAcpChordTools({ cwd: fixtureRoot, serverFor: () => stdioEntry });
  check(
    'ACP: the agent calls a chord tool through the stdio shim',
    stdioRun.listCall?.status === 'completed',
    `status=${stdioRun.listCall?.status} calls=${stdioRun.calls.length}`
  );

  const endpointLog = /chord-mcp endpoint: listening/.test(readStdout());
  check('main logged the loopback endpoint start', endpointLog);
} finally {
  await close();
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All agent-tool checks passed');
