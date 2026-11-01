#!/usr/bin/env node
/* global document, getComputedStyle -- page.evaluate callbacks run inside the app window */
/**
 * P2 done-check, run against a PACKAGED build (plan 2026-09-23 §4 P2).
 *
 *   node scripts/e2e/artifact-publish-tool.mjs [path/to/Chord.exe]
 *
 * Drives REAL Claude sessions (the user's own Claude login; three short turns)
 * in a work item of a seeded profile and asserts:
 *
 *   1. a session calls publish_artifact on plan.md → the card appears
 *   2. writing notes.md without publishing → no artifact, an "Add to artifacts" chip
 *   3. publishing plan.md again returns created: false
 *   4. toggle off → a new session's tool list has no mcp__chord__*, and no chip
 *   5. toggle on → a new session's tool list has the chord tools and no built-in Artifact tool
 *   6. Settings › Agents › Artifacts renders both cards with the §3 layout and tokens
 *
 * The session tool list is the CLI's own `init` list, logged by main
 * (`claude-sdk-session: artifact publishing tools`). Exits non-zero on failure.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from './experience/run-record.mjs';
import { launchSeededApp } from './seeded-app.mjs';

const FIXTURE_DIR = '.chord-p2-fixtures';
const TURN_TIMEOUT_MS = 5 * 60_000;
const SHOT_DIR = E2E_SHOTS_DIR;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const { page, rpc, readStdout, close } = await launchSeededApp({
  exe: process.argv[2],
  profilePrefix: 'chord-p2-e2e',
  env: { LOG_LEVEL: 'info' },
});

async function call(channel, ...args) {
  const res = await rpc(channel, ...args);
  if (!res?.success) throw new Error(`${channel} failed: ${JSON.stringify(res)}`);
  return res.data;
}

/** The publishing-tools line main logs when the CLI reports its tool list, after `offset`. */
async function waitForToolsLog(offset) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const text = readStdout().slice(offset);
    const at = text.indexOf('artifact publishing tools');
    if (at >= 0) {
      const tail = text.slice(at);
      const end = tail.indexOf('}');
      if (end >= 0) {
        const body = tail.slice(0, end + 1);
        return {
          chordTools: [...body.matchAll(/'(mcp__chord__\w+)'/g)].map((m) => m[1]),
          builtInArtifactTool: /builtInArtifactTool: true/.test(body),
          raw: body.replace(/\s+/g, ' '),
        };
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('No "artifact publishing tools" log line from the session');
}

/**
 * Sends one prompt to a session and waits for its turn to complete, answering
 * each permission request with allow-once (chat sessions run in the default
 * permission mode, where Write and MCP tools ask).
 */
async function runTurn(workItemId, sessionId, content) {
  const sentAt = Math.floor(Date.now() / 1000);
  await call('chatMessages.sendToAgent', {
    workItemId,
    sessionId,
    content,
    agentProviderId: 'claude',
  });
  const answered = new Set();
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { turns } = await call('chatMessages.getTimelineTurns', { workItemId, sessionId });
    for (const turn of turns) {
      for (const item of turn.items) {
        if (item.kind !== 'permission' || item.resolved || answered.has(item.requestId)) continue;
        answered.add(item.requestId);
        await call('acp.respondToPermission', {
          workItemId,
          requestId: item.requestId,
          optionId: 'allow_once',
        });
      }
    }
    const streaming = turns.some((t) => t.status === 'streaming');
    const done = turns.filter((t) => t.status === 'complete' && t.timestamp >= sentAt);
    if (!streaming && done.length > 0) return done.flatMap((t) => t.items);
    await page.waitForTimeout(1000);
  }
  throw new Error(`Turn did not complete within ${TURN_TIMEOUT_MS / 1000}s`);
}

async function startClaudeSession(workItemId) {
  const { session } = await call('agentSessions.create', {
    workItemId,
    kind: 'chat',
    agentProviderId: 'claude',
    communication: 'acp',
  });
  return session;
}

async function setArtifactsSetting(enabled) {
  // appSettings RPCs return the value itself, not a Result; a failure rejects.
  // The update takes the whole value; keep the fields this check does not set.
  const current = await rpc('appSettings.get', 'artifacts');
  await rpc('appSettings.update', 'artifacts', {
    ...current,
    enabled,
    preferredFormat: 'best-fit',
  });
  const saved = await rpc('appSettings.get', 'artifacts');
  if (saved?.enabled !== enabled)
    throw new Error(`artifacts setting not saved: ${JSON.stringify(saved)}`);
}

let fixtureRoot = null;
try {
  const { items } = await call('workItems.getAll');
  const workItem = items.find((w) => w.repoPath && existsSync(w.repoPath));
  if (!workItem) throw new Error('Seed profile has no work item with an existing repoPath');

  // ── 1–3: publish, chip, republish ──────────────────────────────────────
  await setArtifactsSetting(true);
  const sessionA = await startClaudeSession(workItem.id);
  fixtureRoot = join(sessionA.cwd, FIXTURE_DIR);
  mkdirSync(fixtureRoot, { recursive: true });
  const planPath = join(fixtureRoot, 'plan.md');
  const notesPath = join(fixtureRoot, 'notes.md');

  let offset = readStdout().length;
  const itemsA = await runTurn(
    workItem.id,
    sessionA.id,
    [
      'This is an automated test of Chord. Do exactly these steps, in order, and nothing else:',
      `1. Write the file ${FIXTURE_DIR}/plan.md with the content "# P2 plan" and one sentence.`,
      `2. Call the publish_artifact tool with path "${FIXTURE_DIR}/plan.md".`,
      `3. Write the file ${FIXTURE_DIR}/notes.md with the content "# Scratch notes". Do not publish it.`,
      `4. Call the publish_artifact tool again with path "${FIXTURE_DIR}/plan.md".`,
      '5. Reply with the exact JSON text the second publish_artifact call returned.',
    ].join('\n')
  );
  const toolsA = await waitForToolsLog(offset);
  check(
    'session with artifacts on lists the chord tools',
    toolsA.chordTools.includes('mcp__chord__publish_artifact') &&
      toolsA.chordTools.includes('mcp__chord__list_artifacts'),
    toolsA.raw
  );

  const { artifacts } = await call('artifacts.listByWorkItem', workItem.id);
  const planArtifact = artifacts.find((a) => a.filePath === planPath);
  check('publish_artifact on plan.md creates the artifact', !!planArtifact, planPath);
  check(
    'the turn carries the artifact card for plan.md',
    itemsA.some((i) => i.kind === 'artifact' && i.filePath === planPath)
  );
  check(
    'notes.md written without publishing is not an artifact',
    !artifacts.some((a) => a.filePath === notesPath)
  );
  const chip = itemsA.find((i) => i.kind === 'unpublished_documents');
  check(
    'notes.md becomes an unpublished-document chip, plan.md does not',
    !!chip &&
      chip.files.some((f) => f.filePath === notesPath) &&
      !chip.files.some((f) => f.filePath === planPath),
    JSON.stringify(chip?.files ?? null)
  );

  const publishCalls = itemsA
    .filter((i) => i.kind === 'tool_group')
    .flatMap((g) => g.tools)
    .filter((t) => t.name.includes('publish_artifact'));
  const results = publishCalls.map((t) =>
    (t.contentBlocks ?? []).map((b) => b.text ?? '').join('')
  );
  const reply = itemsA
    .filter((i) => i.kind === 'text')
    .map((i) => i.text)
    .join('\n');
  check(
    'publishing plan.md again returns created: false',
    publishCalls.length >= 2 &&
      (/"created":\s*false/.test(results.at(-1) ?? '') || /"created":\s*false/.test(reply)),
    `calls=${publishCalls.length} last=${results.at(-1) ?? ''} reply=${reply.slice(0, 200)}`
  );

  // The chip, through the UI: open the work item and find it under the turn.
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('button, a, div, span')].find(
      (el) => el.children.length < 4 && el.textContent.trim() === name
    );
    if (!row) throw new Error(`Sidebar row not found: ${name}`);
    row.click();
  }, workItem.name);
  // The work item opens on its default tab; the test's session is its own
  // sidebar row ("Agent session") under the work item.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('button, a, div, span')].find(
      (el) => el.children.length < 4 && el.textContent.trim() === 'Agent session'
    );
    if (!row) throw new Error('Session row not found: Agent session');
    row.click();
  });
  const chipVisible = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent.trim() === 'Add to artifacts' && b.offsetParent !== null
        ),
      null,
      { timeout: 30_000 }
    )
    .then(() => true)
    .catch(() => false);
  check('"Add to artifacts" chip renders under the turn', chipVisible);
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, 'p2-publish-turn.png') });

  // ── 4: toggle off ──────────────────────────────────────────────────────
  await setArtifactsSetting(false);
  const sessionB = await startClaudeSession(workItem.id);
  offset = readStdout().length;
  const itemsB = await runTurn(
    workItem.id,
    sessionB.id,
    `Write the file ${FIXTURE_DIR}/notes-off.md with the content "# Off". Then reply "done".`
  );
  const toolsB = await waitForToolsLog(offset);
  check(
    'toggle off: new session has no mcp__chord__* tools',
    toolsB.chordTools.length === 0,
    toolsB.raw
  );
  check(
    'toggle off: no unpublished-document chip',
    !itemsB.some((i) => i.kind === 'unpublished_documents')
  );

  // ── 5: toggle on ───────────────────────────────────────────────────────
  await setArtifactsSetting(true);
  const sessionC = await startClaudeSession(workItem.id);
  offset = readStdout().length;
  await runTurn(workItem.id, sessionC.id, 'Reply with the single word ok.');
  const toolsC = await waitForToolsLog(offset);
  check(
    'toggle on: new session has the chord tools and no built-in Artifact tool',
    toolsC.chordTools.includes('mcp__chord__publish_artifact') && !toolsC.builtInArtifactTool,
    toolsC.raw
  );

  // ── 6: Settings › Agents › Artifacts ───────────────────────────────────
  await page.click('[title="Settings"]');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Artifacts'),
    null,
    { timeout: 30_000 }
  );
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Artifacts'
    );
    if (!tab) throw new Error('Artifacts settings tab not found');
    tab.click();
  });
  await page.waitForSelector('#settings-card-preferred-format', { timeout: 15_000 });
  // Rows fade their background in (transition-colors); read styles once settled.
  await page.waitForTimeout(1000);
  const settingsView = await page.evaluate(() => {
    const text = document.body.innerText;
    const card = document.querySelector('#settings-card-artifacts > div:last-child');
    const selected = document.querySelector(
      '#settings-card-preferred-format label:has([data-checked])'
    );
    const pill = [...document.querySelectorAll('#settings-card-preferred-format span')].find(
      (s) => s.textContent === 'Edit together'
    );
    const root = getComputedStyle(document.documentElement);
    const token = (name) => {
      const probe = document.createElement('div');
      probe.style.background = `var(${name})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    return {
      hasText: [
        'Let agents create artifacts',
        'Preferred format',
        'Agents use this unless you ask for something else.',
        'Best fit (Recommended)',
        'Document',
        'Rich document',
        'Web page',
        'Interactive prototype',
        'Edit together',
        'Edit in place',
        'Edit with agent',
        'Markdown',
        'MDX',
        'HTML',
        'React',
      ].filter((t) => !text.includes(t)),
      // Publishing ships with Confluence (P5); Canvas and the delete confirmation have not.
      forbidden: ['Canvas', 'Ask before deleting'].filter((t) =>
        document
          .querySelector('#settings-card-artifacts, #settings-card-preferred-format')
          ?.parentElement?.innerText.includes(t)
      ),
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      selectedBg: selected ? getComputedStyle(selected).backgroundColor : null,
      pillBg: pill ? getComputedStyle(pill).backgroundColor : null,
      surfaceRaised: token('--surface-raised'),
      selectedToken: token('--selected-bg'),
      insetToken: token('--surface-inset'),
      theme: root.getPropertyValue('color-scheme'),
    };
  });
  check(
    'Settings › Agents › Artifacts shows both cards, five format rows and achromatic tags',
    settingsView.hasText.length === 0,
    `missing: ${JSON.stringify(settingsView.hasText)}`
  );
  check(
    'no Canvas row or delete confirmation before they ship',
    settingsView.forbidden.length === 0,
    JSON.stringify(settingsView.forbidden)
  );
  check(
    'cards sit on --surface-raised, the selected row on --selected-bg, tags on --surface-inset',
    settingsView.cardBg === settingsView.surfaceRaised &&
      settingsView.selectedBg === settingsView.selectedToken &&
      settingsView.pillBg === settingsView.insetToken,
    JSON.stringify(settingsView)
  );
  await page.screenshot({ path: join(SHOT_DIR, 'p2-settings-artifacts.png') });
} finally {
  await close();
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All publish-tool checks passed');
