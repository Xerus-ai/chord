/* global document, Node -- page.evaluate callbacks run inside the app window */
/**
 * Live checks for plan §Phase 5 (devstation-b4p.4), driven through the real
 * UI with a real agent (the user's own Claude or Codex login):
 *
 *   1. Two turns: the agent remembers ALPHA-17 and writes notes.md = "one",
 *      then remembers BRAVO-29 and rewrites it to "two".
 *   2. Reset to here on turn 1 (turn footer → confirm): notes.md is "one"
 *      again, turn 2 shows under "Not in <agent>'s memory since the reset",
 *      and asked afterwards, the agent remembers ALPHA-17 and not BRAVO-29.
 *   3. Fork to new tab on turn 1 ("…" menu): a new chat tab opens on the same
 *      lane, and its agent remembers only ALPHA-17.
 *   4. Fork to new worktree on turn 1: a new lane `<branch>--fork` with
 *      notes.md = "one" uncommitted; its chat remembers only ALPHA-17 and
 *      writes files in the new lane's folder, not the source's.
 *   5. Archive the forked lane (lane menu → confirm): its folder goes, the
 *      work item lists "Archived (1)"; Restore brings the folder back with
 *      its uncommitted files.
 *
 * Needs the sync server (.env VITE_CLOUD_API_URL) and a signed-in seed
 * profile (CHORD_E2E_PROFILE, default chord-p1-smoke). Uses a scratch
 * repository under the OS temp folder; the work item is deleted in the app at
 * the end. Screenshots: screenshots/e2e/history-<agent>-*.png.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../experience/run-record.mjs';
import { runTranscriptExperienceCheck } from '../experience/transcript-experience.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../sharing/sharing-accounts.mjs';
import {
  createScratchRepo,
  createWorkItem,
  listChats,
  openChat,
  readText,
  replyText,
  runTurn,
  statusLines,
  switchToChat,
  turnBox,
  waitForNewChat,
} from './history-chat.mjs';

const SEED_PROFILE = process.env.CHORD_E2E_PROFILE ?? 'chord-p1-smoke';
const SHOTS = E2E_SHOTS_DIR;

const TURN_1 =
  'This is an automated test of Chord. Remember the codeword ALPHA-17. ' +
  'Write the file notes.md containing exactly the line: one. Then reply OK.';
const TURN_2 =
  'Also remember the codeword BRAVO-29. Overwrite notes.md so it contains exactly ' +
  'the line: two. Then reply OK.';
const ASK =
  'Which codewords have I asked you to remember in this conversation? ' +
  'Reply with only the codewords, and do not use any tools.';
const WRITE_HERE = 'Write the file forked.md containing exactly the line: forked. Then reply OK.';

function createResults(agentKey) {
  const results = [];
  let shotCount = 0;
  mkdirSync(SHOTS, { recursive: true });
  return {
    results,
    check(name, ok, detail) {
      results.push({ name, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    },
    shot: (name) =>
      join(SHOTS, `history-${agentKey}-${String(++shotCount).padStart(2, '0')}-${name}.png`),
  };
}

/** True when the reply names ALPHA-17 and not BRAVO-29. */
function remembersOnlyTurn1(text) {
  return /ALPHA-17/.test(text) && !/BRAVO-29/.test(text);
}

async function checkTwoTurns(ctx, chat, lanePath) {
  await runTurn(ctx.account, chat, TURN_1);
  const afterOne = readText(join(lanePath, 'notes.md'));
  await runTurn(ctx.account, chat, TURN_2);
  const afterTwo = readText(join(lanePath, 'notes.md'));
  await turnBox(ctx.page, 1).scrollIntoViewIfNeeded();
  await ctx.page.screenshot({ path: ctx.r.shot('two-turns') });
  ctx.r.check(
    `${ctx.agent.name} writes notes.md in each turn`,
    afterOne === 'one' && afterTwo === 'two',
    `after turn 1: ${afterOne}; after turn 2: ${afterTwo}`
  );
  // devstation-6re: with nothing found to import, the rail does not list the
  // agents that can't be imported (it did under every work item).
  const importNote = await ctx.page.getByText(/can't be imported/).count();
  ctx.r.check(
    'the rail says nothing about agents that cannot be imported when nothing is offered',
    importNote === 0,
    `"can't be imported" shown ${importNote} time(s)`
  );
  // Prompt 2 goes out the moment turn 1 is saved, often in the same second;
  // it must still read below turn 1's reply (devstation-vihv).
  const turn1BeforePrompt2 = await ctx.page.evaluate((prompt2) => {
    const transcript = document.querySelector('[data-testid="chat-transcript"]');
    const turn1 = transcript?.querySelector('.group\\/turn');
    const bubble = [...(transcript?.querySelectorAll('*') ?? [])].find(
      (el) => el.children.length === 0 && el.textContent?.trim() === prompt2
    );
    if (!turn1 || !bubble) return null;
    return Boolean(turn1.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, TURN_2);
  ctx.r.check(
    'turn 1 reads above prompt 2',
    turn1BeforePrompt2 === true,
    turn1BeforePrompt2 === null ? 'turn 1 or prompt 2 not found' : `in order: ${turn1BeforePrompt2}`
  );
}

/** Whether the chat session is among the app's running sessions now. */
async function isChatRunning(account, sessionId) {
  const { sessions } = await account.call('agentSessions.listRunningSessions');
  return sessions.some((session) => session.sessionId === sessionId);
}

async function checkReset(ctx, chat, lanePath) {
  const turn = turnBox(ctx.page, 0);
  await turn.hover();
  await turn.getByRole('button', { name: 'Reset to here' }).click();
  const confirm = ctx.page.getByRole('dialog', { name: 'Reset to here' });
  await confirm.waitFor({ timeout: 10_000 });
  await ctx.page.screenshot({ path: ctx.r.shot('reset-confirm') });
  await confirm.getByRole('button', { name: 'Reset', exact: true }).click();
  await waitFor(async () => readText(join(lanePath, 'notes.md')) === 'one', 60_000, 'files reset');
  const marker = ctx.page.getByText(`Not in ${ctx.agent.name}'s memory since the reset`);
  await marker.first().waitFor({ timeout: 30_000 });
  await ctx.page.screenshot({ path: ctx.r.shot('reset-done') });
  ctx.r.check(
    'Reset to here puts the files back to after turn 1 and dims turn 2',
    readText(join(lanePath, 'notes.md')) === 'one' && (await marker.first().isVisible()),
    `notes.md: ${readText(join(lanePath, 'notes.md'))}`
  );
  // Reset stops the agent to fork its conversation and starts nothing: the next
  // send resumes the fork (devstation-6z4o). The rail calls the chat "ready",
  // never "suspended", in the meantime. It is the suite's only chat here.
  const readyWord = ctx.page.getByText('ready', { exact: true });
  const readsReady = await readyWord
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  const suspendedShown = await ctx.page.getByText('suspended', { exact: true }).count();
  const running = await isChatRunning(ctx.account, chat.sessionId);
  await ctx.page.screenshot({ path: ctx.r.shot('reset-ready') });
  ctx.r.check(
    'after the Reset, no agent runs and the rail calls the chat ready, not suspended',
    !running && readsReady && suspendedShown === 0,
    `running: ${running}, "ready" shown: ${readsReady}, "suspended" shown: ${suspendedShown}`
  );

  const answer = replyText(await runTurn(ctx.account, chat, ASK));
  await ctx.page.screenshot({ path: ctx.r.shot('reset-memory') });
  ctx.r.check(
    `after the Reset, ${ctx.agent.name} remembers turn 1 and not turn 2`,
    remembersOnlyTurn1(answer),
    `reply: ${answer.slice(0, 200)}`
  );
  await runTranscriptExperienceCheck({
    id: 'reset',
    account: ctx.account,
    who: 'the owner',
    typed: [TURN_1, TURN_2, ASK],
    results: ctx.r,
  });
}

async function forkFromTurn1(ctx, item) {
  const turn = turnBox(ctx.page, 0);
  await turn.hover();
  await turn.getByRole('button', { name: 'More for this turn' }).click();
  await ctx.page.screenshot({
    path: ctx.r.shot(`fork-menu-${item === 'Fork to new tab' ? 'tab' : 'worktree'}`),
  });
  await ctx.page.getByRole('menuitem', { name: item }).click();
}

async function checkForkToTab(ctx, chat, workItemId) {
  const known = (await listChats(ctx.account, workItemId)).map((s) => s.id);
  await forkFromTurn1(ctx, 'Fork to new tab');
  const fork = await waitForNewChat(ctx.account, workItemId, known, 'the forked tab');
  const forkChat = { ...chat, sessionId: fork.id };
  await ctx.page.getByText('Forked from', { exact: false }).first().waitFor({ timeout: 30_000 });
  const answer = replyText(await runTurn(ctx.account, forkChat, ASK));
  await ctx.page.screenshot({ path: ctx.r.shot('fork-tab') });
  ctx.r.check(
    'Fork to new tab opens a chat on the same lane that remembers only turn 1',
    fork.worktreeId === chat.worktreeId && remembersOnlyTurn1(answer),
    `lane ${fork.worktreeId}; reply: ${answer.slice(0, 200)}`
  );
  await runTranscriptExperienceCheck({
    id: 'fork-tab',
    account: ctx.account,
    who: 'the owner',
    typed: [TURN_1, ASK],
    results: ctx.r,
  });
}

async function checkForkToWorktree(ctx, chat, workItemId, source) {
  await switchToChat(ctx.page, chat.sessionId);
  const known = (await listChats(ctx.account, workItemId)).map((s) => s.id);
  await forkFromTurn1(ctx, 'Fork to new worktree');
  const fork = await waitForNewChat(ctx.account, workItemId, known, 'the forked worktree chat');
  const { worktrees } = await ctx.account.call('worktrees.list', workItemId);
  const lane = worktrees.find((w) => w.id === fork.worktreeId);
  ctx.r.check(
    'Fork to new worktree makes a lane named after the work item, with turn 1’s files uncommitted',
    Boolean(lane) &&
      lane.branchName === `${source.branchName}--fork` &&
      readText(join(lane.path, 'notes.md')) === 'one' &&
      statusLines(lane.path).includes('?? notes.md'),
    lane
      ? `${lane.branchName} at ${lane.path}; status ${statusLines(lane.path).join(', ')}`
      : 'no lane'
  );
  const forkChat = { ...chat, sessionId: fork.id, worktreeId: lane.id };
  const answer = replyText(await runTurn(ctx.account, forkChat, ASK));
  await runTurn(ctx.account, forkChat, WRITE_HERE);
  await ctx.page.screenshot({ path: ctx.r.shot('fork-worktree') });
  // Three chats now: the source, its fork to a tab, its fork to this lane. Each
  // tab must read differently (devstation-6z9s).
  // What the tab shows, not its textContent: Codex's logo is an inline SVG
  // whose <title>OpenAI</title> would otherwise lead every label.
  const tabLabels = (await ctx.page.getByRole('tab').allInnerTexts())
    .map((label) => label.trim())
    .filter((label) => label.includes(ctx.agent.name));
  ctx.r.check(
    'the chat tabs of the source and both forks read differently',
    tabLabels.length === 3 && new Set(tabLabels).size === 3,
    `tabs: ${tabLabels.join(' | ')}`
  );
  // devstation-w366: the lane tag is shown whole, inside its tab, even when
  // the title has to be cut ("Claude Code (for…" hid it).
  const tagged = ctx.page
    .locator('[role="tab"]')
    .filter({ has: ctx.page.locator('[data-tab-tag]') });
  const tagFits = await tagged.first().evaluate((tab) => {
    const tag = tab.querySelector('[data-tab-tag]');
    const tabBox = tab.getBoundingClientRect();
    const tagBox = tag.getBoundingClientRect();
    return (
      tagBox.width > 0 && tagBox.right <= tabBox.right + 0.5 && tag.scrollWidth <= tag.clientWidth
    );
  });
  ctx.r.check(
    "the forked worktree's tab shows its lane tag whole",
    tagFits,
    `${await tagged.count()} tagged tab(s); tag fits: ${tagFits}`
  );
  ctx.r.check(
    'the forked worktree’s chat remembers only turn 1 and works in the new lane’s folder',
    remembersOnlyTurn1(answer) &&
      readText(join(lane.path, 'forked.md')) === 'forked' &&
      !existsSync(join(source.path, 'forked.md')),
    `reply: ${answer.slice(0, 200)}; forked.md in new lane: ${readText(join(lane.path, 'forked.md'))}`
  );
  await runTranscriptExperienceCheck({
    id: 'fork-worktree',
    account: ctx.account,
    who: 'the owner',
    typed: [TURN_1, ASK, WRITE_HERE],
    results: ctx.r,
  });
  return lane;
}

/** The agent's chat tabs as shown, and the one that is active. */
async function readChatTabs(ctx) {
  const shown = (await ctx.page.getByRole('tab').allInnerTexts())
    .map((label) => label.trim())
    .filter((label) => label.includes(ctx.agent.name));
  // The right rail's panel tabs are tabs too ("Work item" is selected there).
  const selected = await ctx.page.locator('[role="tab"][aria-selected="true"]').allInnerTexts();
  const activeLabel =
    selected.map((label) => label.trim()).find((label) => label.includes(ctx.agent.name)) ?? '';
  return { shown, activeLabel };
}

async function checkArchiveRestore(ctx, workItemId, lane) {
  const before = statusLines(lane.path);
  const tabsBefore = await readChatTabs(ctx);
  const row = ctx.page.locator(`[data-lane-row="${lane.id}"]`);
  await row.hover();
  await row.getByRole('button', { name: 'Branch actions' }).click();
  await ctx.page.getByRole('menuitem', { name: 'Archive' }).click();
  const confirm = ctx.page.getByRole('dialog').filter({ hasText: 'Archive' });
  await confirm.waitFor({ timeout: 10_000 });
  await ctx.page.screenshot({ path: ctx.r.shot('archive-confirm') });
  await confirm.getByRole('button', { name: 'Archive', exact: true }).click();
  await waitFor(async () => !existsSync(lane.path), 60_000, 'the archived checkout to go');
  const group = ctx.page.getByRole('button', { name: 'Archived (1)' });
  await group.waitFor({ timeout: 30_000 });
  const { lanes } = await ctx.account.call('worktrees.listArchived', workItemId);
  await ctx.page.screenshot({ path: ctx.r.shot('archived') });
  ctx.r.check(
    'Archive removes the checkout and lists the lane under "Archived (1)"',
    !existsSync(lane.path) && lanes.some((archived) => archived.id === lane.id),
    `archived: ${lanes.map((archived) => archived.branchName).join(', ')}`
  );
  // devstation-lf5i: the archived lane's chat (the active tab) leaves the
  // strip, and another chat is shown — no composer on a checkout that is gone.
  let tabsAfter = await readChatTabs(ctx);
  await waitFor(
    async () => {
      tabsAfter = await readChatTabs(ctx);
      return tabsAfter.shown.length === tabsBefore.shown.length - 1;
    },
    10_000,
    "the archived lane's chat tab to close"
  ).catch(() => {});
  ctx.r.check(
    "Archive closes the archived lane's chat tab and shows another chat",
    tabsAfter.shown.length === tabsBefore.shown.length - 1 &&
      tabsAfter.activeLabel.includes(ctx.agent.name) &&
      !tabsAfter.shown.some((label) => label.includes('· fork')),
    `before: ${tabsBefore.shown.join(' | ')} (active ${tabsBefore.activeLabel}); after: ${tabsAfter.shown.join(' | ')} (active ${tabsAfter.activeLabel})`
  );

  // Long enough for the rail's slowest git poll (15 s) to run while the lane
  // has no checkout, which is what left "Read commits failed" up after
  // Restore (devstation-b3d4).
  await new Promise((resolve) => setTimeout(resolve, 16_000));
  const railErrorWhileArchived = await ctx.page.getByText('Read commits failed').count();

  await group.click();
  const archivedRow = ctx.page.locator(`[data-archived-lane="${lane.id}"]`);
  // Watched from the click: a stale error shows the moment the lane is back
  // and may clear within a second, and the user still saw it (devstation-b3d4).
  const railErrors = ctx.page.getByText('Read commits failed');
  let railErrorSightings = 0;
  let watching = true;
  const watch = (async () => {
    while (watching) {
      if ((await railErrors.count()) > 0) railErrorSightings += 1;
      await ctx.page.waitForTimeout(100);
    }
  })();
  await archivedRow.getByRole('button', { name: 'Restore' }).click();
  await waitFor(async () => existsSync(join(lane.path, 'forked.md')), 120_000, 'the restore');
  await row.waitFor({ timeout: 30_000 });
  await ctx.page.screenshot({ path: ctx.r.shot('restored') });
  const after = statusLines(lane.path);
  ctx.r.check(
    'Restore brings the checkout back with its uncommitted files',
    readText(join(lane.path, 'notes.md')) === 'one' &&
      readText(join(lane.path, 'forked.md')) === 'forked' &&
      after.join('|') === before.join('|'),
    `status before: ${before.join(', ')}; after: ${after.join(', ')}`
  );
  await ctx.page.waitForTimeout(3_000);
  watching = false;
  await watch;
  ctx.r.check(
    'Restore never shows a stale read error in the rail',
    railErrorSightings === 0,
    `"Read commits failed" while archived: ${railErrorWhileArchived}; ` +
      `seen from the Restore click to 3 s after: ${railErrorSightings} times`
  );
}

/** `agent`: { key, providerId, name } — the agent's id and the name the UI gives it. */
export async function runHistorySuite(agent) {
  const r = createResults(agent.key);
  await assertServerHealthy();
  const { scratch, root } = createScratchRepo(`chord-history-${agent.key}-`);
  const account = await launchAccount({ seedProfile: SEED_PROFILE, label: `history-${agent.key}` });
  const { page } = account.instance;
  const ctx = { account, page, agent, r };
  let workItemId = null;
  try {
    const { repo } = await account.call('repos.create', {
      path: root,
      alias: `history-${agent.key}`,
    });
    const { workItem, primary } = await createWorkItem(
      account,
      repo.id,
      `Chord e2e history ${agent.key} ${Date.now()}`
    );
    workItemId = workItem.id;
    const { session } = await account.call('agentSessions.create', {
      workItemId,
      kind: 'chat',
      agentProviderId: agent.providerId,
      communication: 'acp',
    });
    const chat = {
      workItemId,
      sessionId: session.id,
      providerId: agent.providerId,
      worktreeId: primary.id,
    };
    await openChat(page, workItem.name, session.id);

    await checkTwoTurns(ctx, chat, primary.path);
    await checkReset(ctx, chat, primary.path);
    await checkForkToTab(ctx, chat, workItemId);
    const lane = await checkForkToWorktree(ctx, chat, workItemId, primary);
    await checkArchiveRestore(ctx, workItemId, lane);
  } catch (error) {
    await page.screenshot({ path: r.shot('failure') });
    throw error;
  } finally {
    if (workItemId) {
      await account.call('workItems.remove', workItemId);
      await waitFor(
        async () => (await account.api('GET', `/work-items/${workItemId}`)).status === 404,
        60_000,
        'the cloud to drop the run’s work item'
      );
    }
    await account.close();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  const failed = r.results.filter((result) => !result.ok);
  console.log(`\n${r.results.length - failed.length}/${r.results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}
