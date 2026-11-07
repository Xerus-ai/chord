#!/usr/bin/env node
/* global document, window -- page.evaluate callbacks run inside the app window */
/**
 * P4 done-check, run against a PACKAGED build (plan 2026-09-23 §4 P4).
 *
 *   node scripts/e2e/suites/artifact-drift-conflicts.mjs [path/to/Chord.exe]
 *
 * Drives a REAL Claude session (the user's own Claude login) in a work item of
 * a seeded profile and asserts:
 *
 *   1. the agent stops without publishing → exactly one continuation prompt
 *   2. a turn that publishes everything it wrote gets none
 *   3. publish_artifact with sources records them; the card is current
 *   4. editing a listed source flips the card to "Out of date — 1 source file changed"
 *   5. Update asks the agent, which republishes → the card is current again
 *   6. Mark reviewed (in the open artifact) clears drift without touching the file
 *   7. two concurrent saves on one base version → the second gets `conflict`
 *
 * The continuation prompt is counted from main's log line
 * (`claude-sdk: publish nudge blocked stop`). Exits non-zero on failure.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { launchSeededApp } from '../lib/seeded-app.mjs';

const FIXTURE_DIR = '.chord-p4-fixtures';
const TURN_TIMEOUT_MS = 5 * 60_000;
const SHOT_DIR = E2E_SHOTS_DIR;
const NUDGE_LOG = 'publish nudge blocked stop';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const { page, rpc, readStdout, close } = await launchSeededApp({
  exe: process.argv[2],
  profilePrefix: 'chord-p4-e2e',
  env: { LOG_LEVEL: 'info' },
});

async function call(channel, ...args) {
  const res = await rpc(channel, ...args);
  if (!res?.success) throw new Error(`${channel} failed: ${JSON.stringify(res)}`);
  return res.data;
}

function countNudges(offset) {
  return readStdout().slice(offset).split(NUDGE_LOG).length - 1;
}

/**
 * Waits for the work item's turns started after `sentAt` to complete,
 * answering each permission request with allow-once (chat sessions run in the
 * default permission mode, where Write and MCP tools ask).
 */
/**
 * The ids of the turns that exist now. A turn's timestamp is its row's
 * created_at in whole seconds, stamped when it completes, so the turn before a
 * send can carry the send's own second: "a complete turn at or after the send"
 * could be that one (devstation-ngx). The awaited turn is a new id instead.
 */
async function listTurnIds(workItemId, sessionId) {
  const { turns } = await call('chatMessages.getTimelineTurns', { workItemId, sessionId });
  return new Set(turns.map((t) => t.turnId));
}

async function awaitTurns(workItemId, earlierTurnIds, sessionId) {
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
    const done = turns.filter((t) => t.status === 'complete' && !earlierTurnIds.has(t.turnId));
    if (!streaming && done.length > 0) return done.flatMap((t) => t.items);
    await page.waitForTimeout(1000);
  }
  throw new Error(`Turn did not complete within ${TURN_TIMEOUT_MS / 1000}s`);
}

async function runTurn(workItemId, sessionId, content) {
  const earlierTurnIds = await listTurnIds(workItemId, sessionId);
  await call('chatMessages.sendToAgent', {
    workItemId,
    sessionId,
    content,
    agentProviderId: 'claude',
  });
  return awaitTurns(workItemId, earlierTurnIds, sessionId);
}

/** Current drift for one artifact, read through the same RPC pair the UI holds. */
async function readDrift(workItemId, artifactId) {
  const { drift } = await call('artifacts.watchSourceDrift', { workItemId });
  await call('artifacts.unwatchSourceDrift', { workItemId });
  return drift.find((d) => d.artifactId === artifactId) ?? null;
}

async function clickText(selector, text) {
  await page.evaluate(
    ([sel, label]) => {
      const el = [...document.querySelectorAll(sel)].find(
        (node) => node.textContent.trim() === label && node.offsetParent !== null
      );
      if (!el) throw new Error(`Not found: ${sel} "${label}"`);
      el.click();
    },
    [selector, text]
  );
}

/** The drift notices rendered for an artifact: [{ text, inBar }]. */
function readNotices(artifactId) {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-artifact-drift="${id}"]`)]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ text: el.textContent, inBar: el.className.includes('border-b') })),
    artifactId
  );
}

async function waitForNotices(artifactId, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let notices = await readNotices(artifactId);
  while (!predicate(notices) && Date.now() < deadline) {
    await page.waitForTimeout(250);
    notices = await readNotices(artifactId);
  }
  return notices;
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

  const { session } = await call('agentSessions.create', {
    workItemId: workItem.id,
    kind: 'chat',
    agentProviderId: 'claude',
    communication: 'acp',
  });
  fixtureRoot = join(session.cwd, FIXTURE_DIR);
  mkdirSync(fixtureRoot, { recursive: true });
  const designPath = join(fixtureRoot, 'design.md');
  const sourcePath = join(fixtureRoot, 'ttl.ts');
  writeFileSync(sourcePath, 'export const TOKEN_TTL_SECONDS = 60;\n');

  // ── 1: stop without publishing → one continuation prompt ──────────────
  let offset = readStdout().length;
  const itemsNudged = await runTurn(
    workItem.id,
    session.id,
    [
      'This is an automated test of Chord. Do exactly this and nothing else:',
      `Write the file ${FIXTURE_DIR}/notes.md with the content "# P4 scratch notes". Do not publish it. Then reply "done".`,
    ].join('\n')
  );
  // main logs the entry over several lines; its file list follows the marker.
  const nudgeEntries = readStdout()
    .slice(offset)
    .split(NUDGE_LOG)
    .slice(1)
    .map((entry) => entry.split('}')[0].replace(/\s+/g, ' '));
  check(
    'agent stops without publishing → exactly one continuation prompt',
    nudgeEntries.length === 1 && nudgeEntries[0].includes('notes.md'),
    `prompts=${nudgeEntries.length} ${nudgeEntries.join(' | ').slice(0, 300)}`
  );
  check(
    'the nudged turn completes',
    itemsNudged.some((i) => i.kind === 'text'),
    `${itemsNudged.length} items`
  );

  // ── 2–3: publish with sources → no nudge, card current ─────────────────
  offset = readStdout().length;
  const itemsPublished = await runTurn(
    workItem.id,
    session.id,
    [
      'This is an automated test of Chord. Do exactly these steps and nothing else:',
      `1. Write the file ${FIXTURE_DIR}/design.md with the content "# Token design" and the sentence "Access tokens live for the number of seconds in TOKEN_TTL_SECONDS, currently 60."`,
      `2. Call the publish_artifact tool with path "${FIXTURE_DIR}/design.md" and sources ["${FIXTURE_DIR}/ttl.ts"].`,
      '3. Reply "done".',
    ].join('\n')
  );
  check(
    'a turn that publishes what it wrote gets no continuation prompt',
    countNudges(offset) === 0
  );
  const { artifacts } = await call('artifacts.listByWorkItem', workItem.id);
  const design = artifacts.find((a) => a.filePath === designPath);
  // On failure, what the agent's publish calls returned and what it said.
  const publishReplies = itemsPublished
    .filter((i) => i.kind === 'tool_group')
    .flatMap((g) => g.tools)
    .filter((t) => t.name.includes('publish_artifact'))
    .map((t) => (t.contentBlocks ?? []).map((b) => b.text ?? '').join(''));
  const replyText = itemsPublished
    .filter((i) => i.kind === 'text')
    .map((i) => i.text)
    .join(' ');
  check(
    'publish_artifact with sources creates the artifact',
    !!design,
    design
      ? designPath
      : `publish=${JSON.stringify(publishReplies)} reply=${replyText.slice(0, 400)}`
  );
  if (!design) throw new Error('design.md was not published; the drift checks cannot run');
  check(
    'the freshly published artifact is current',
    (await readDrift(workItem.id, design.id)) === null
  );

  // Open the session's transcript: the card lives in the turn footer.
  await clickText('button, a, div, span', workItem.name);
  await page.waitForTimeout(1500);
  await clickText('button, a, div, span', 'Agent session');
  await page.waitForTimeout(1500);
  check('no drift notice while current', (await readNotices(design.id)).length === 0);

  // ── 4: edit a listed source → out of date ──────────────────────────────
  writeFileSync(sourcePath, 'export const TOKEN_TTL_SECONDS = 3600;\n');
  let notices = await waitForNotices(design.id, (n) => n.length > 0);
  check(
    'editing a listed source flips the card to out of date',
    notices.length > 0 &&
      notices.every((n) => n.text.includes('Out of date — 1 source file changed')),
    JSON.stringify(notices)
  );
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, 'p4-card-out-of-date.png') });

  // ── 5: Update asks the agent, which republishes ────────────────────────
  const turnsBeforeUpdate = await listTurnIds(workItem.id);
  await page.evaluate((id) => {
    const notice = [...document.querySelectorAll(`[data-artifact-drift="${id}"]`)].find(
      (el) => el.offsetParent !== null
    );
    const button = [...(notice?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent.trim() === 'Update'
    );
    if (!button) throw new Error('Update button not found');
    button.click();
  }, design.id);
  await awaitTurns(workItem.id, turnsBeforeUpdate);
  const updatedDrift = await readDrift(workItem.id, design.id);
  check(
    'Update: the agent republishes and the artifact is current again',
    updatedDrift === null && readFileSync(designPath, 'utf-8').includes('3600'),
    `drift=${JSON.stringify(updatedDrift)} design=${readFileSync(designPath, 'utf-8').slice(0, 200)}`
  );
  notices = await waitForNotices(design.id, (n) => n.length === 0);
  check(
    'the card drops its notice after the update',
    notices.length === 0,
    JSON.stringify(notices)
  );

  // ── 6: Mark reviewed, from the open artifact ───────────────────────────
  writeFileSync(sourcePath, 'export const TOKEN_TTL_SECONDS = 3600; // reviewed: comment only\n');
  await waitForNotices(design.id, (n) => n.length > 0);
  await page.evaluate((id) => {
    const chip = [...document.querySelectorAll('button[title]')].find((b) =>
      b.title.includes('design.md')
    );
    if (!chip) throw new Error(`Artifact chip not found for ${id}`);
    chip.click();
  }, design.id);
  notices = await waitForNotices(design.id, (n) => n.some((x) => x.inBar));
  check(
    'the open artifact shows the out-of-date bar',
    notices.some((n) => n.inBar && n.text.includes('Out of date')),
    JSON.stringify(notices)
  );
  await page.screenshot({ path: join(SHOT_DIR, 'p4-artifact-out-of-date-bar.png') });
  const designBefore = readFileSync(designPath, 'utf-8');
  await page.evaluate((id) => {
    const bar = [...document.querySelectorAll(`[data-artifact-drift="${id}"]`)].find(
      (el) => el.offsetParent !== null && el.className.includes('border-b')
    );
    const button = [...(bar?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent.trim() === 'Mark reviewed'
    );
    if (!button) throw new Error('Mark reviewed button not found');
    button.click();
  }, design.id);
  notices = await waitForNotices(design.id, (n) => n.length === 0);
  check(
    'Mark reviewed clears drift everywhere without touching the artifact file',
    notices.length === 0 &&
      (await readDrift(workItem.id, design.id)) === null &&
      readFileSync(designPath, 'utf-8') === designBefore,
    JSON.stringify(notices)
  );

  // ── 7: concurrent saves ────────────────────────────────────────────────
  const before = (await call('artifacts.listVersions', { artifactId: design.id })).versions;
  const base = before[0]?.versionNumber ?? 0;
  const results = await page.evaluate(
    ([artifactId, baseVersion]) =>
      Promise.all(
        ['mine', 'theirs'].map((label) =>
          window.electronAPI.invoke('artifacts.saveVersion', {
            artifactId,
            content: `# ${label}`,
            trigger: 'manual',
            label,
            baseVersion,
          })
        )
      ),
    [design.id, base]
  );
  const after = (await call('artifacts.listVersions', { artifactId: design.id })).versions;
  const saved = results.filter((r) => r?.success === true);
  const conflicts = results.filter((r) => r?.success === false && r.error?.type === 'conflict');
  check(
    'two concurrent saves on one base: one is saved, the other gets conflict',
    saved.length === 1 &&
      conflicts.length === 1 &&
      conflicts[0].error.latestVersion === base + 1 &&
      after.length === before.length + 1,
    JSON.stringify(results.map((r) => (r.success ? 'saved' : r.error)))
  );
} finally {
  await close();
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All drift and conflict checks passed');
