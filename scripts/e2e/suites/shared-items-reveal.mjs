#!/usr/bin/env node
/**
 * Shared-items step 5 done-check with two real accounts: a chat notification
 * opens the chat holding its message, scrolled to it and highlighted, from the
 * bell (the shared-items step 5 plan §3).
 *
 *   1. The owner mentions the teammate in a row older than the teammate's
 *      first page, in a chat the teammate has no tab for: the click opens and
 *      focuses that chat, pages back to the row, shows it highlighted, and the
 *      transcript is not at the bottom; new rows do not pull it down.
 *   2. The reverse: the teammate mentions the owner in that chat; the owner's
 *      click reveals it in the owner's chat.
 *   3. The owner ends that chat; a mention in it reopens it as a tab, its
 *      composer closed ("This chat has ended."), the row revealed; the owner's
 *      `+` lists it under Ended.
 *   4. A mention naming a message that is not there says so in place.
 *   5. A row of no chat (the item's history) with no chat tab open opens in
 *      the newest chat that has not ended, revealed.
 *
 *   node scripts/e2e/lib/build-e2e-app.mjs   # the app in .e2e-app/
 *   pnpm run dev:server                  # the sync server on :1234
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/suites/shared-items-reveal.mjs
 *
 * Seed profiles as in artifact-sharing.mjs (CHORD_E2E_AUTHOR_PROFILE, default
 * `chord-b`; CHORD_E2E_TEAMMATE_PROFILE, default `chord-p1-smoke`). The work
 * item, its chats and its rows are the suite's own and are deleted at the end;
 * exits non-zero on any failure, a cleanup failure included. Screenshots:
 * <e2e out>/screenshots/shared-reveal-*.png.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runTranscriptExperienceCheck } from '../lib/experience/transcript-experience.mjs';
import { closeBell, waitForBellRow } from '../lib/sharing/notification-helpers.mjs';
import {
  chatTab,
  closeChatTab,
  createRevealWorkItem,
  mention,
  pushHistory,
  pushOne,
  readRevealState,
  waitForReveal,
} from '../lib/sharing/reveal-helpers.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';
import { createCleanup, createResults, expectStatus } from '../lib/sharing/sharing-fixtures.mjs';
import { followLink, SHOT_DIR } from '../lib/sharing/teammate-ui-helpers.mjs';

const AUTHOR_PROFILE = process.env.CHORD_E2E_AUTHOR_PROFILE ?? 'chord-b';
const TEAMMATE_PROFILE = process.env.CHORD_E2E_TEAMMATE_PROFILE ?? 'chord-p1-smoke';

await assertServerHealthy();
const results = createResults();
const { check } = results;
const cleanup = createCleanup();
const stamp = Date.now();

async function shot(account, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await account.instance.page.waitForTimeout(300);
  await account.instance.page.screenshot({ path: join(SHOT_DIR, `shared-reveal-${name}.png`) });
}

async function isSelected(tab) {
  return (await tab.count()) > 0 && (await tab.getAttribute('aria-selected')) === 'true';
}

const author = await launchAccount({ seedProfile: AUTHOR_PROFILE, label: 'author' });
const mate = await launchAccount({ seedProfile: TEAMMATE_PROFILE, label: 'teammate' });
let runError = null;
try {
  if (author.userId === mate.userId) {
    throw new Error(`${AUTHOR_PROFILE} and ${TEAMMATE_PROFILE} are signed in to the same account`);
  }
  const authorPage = author.instance.page;
  const matePage = mate.instance.page;
  const {
    workItemId,
    name: itemName,
    chats,
  } = await createRevealWorkItem({
    author,
    mate,
    stamp,
    cleanup,
  });
  const itemPath = `/work-items/${workItemId}`;
  const labelA = `Reveal A ${stamp}`;
  const labelB = `Reveal B ${stamp}`;
  await followLink(author, `chord://open/work-item/${workItemId}`);

  // 1. 120 rows in chat A, older than the teammate's first page (100), the
  //    target the 5th oldest.
  const history = await pushHistory(author, workItemId, {
    sessionId: chats.A.id,
    count: 120,
    label: `A ${stamp}`,
  });
  const target = history[4];
  const excerpt1 = `@teammate look at row 5 ${stamp}`;
  await mention(author, workItemId, {
    userId: mate.userId,
    excerpt: excerpt1,
    messageId: target.id,
  });
  const row1 = await waitForBellRow(mate, excerpt1);
  await row1.click();
  const tabA = chatTab(matePage, labelA);
  const opened = await waitFor(async () => isSelected(tabA), 45_000, 'chat A focused').then(
    () => true,
    () => false
  );
  const state1 = await waitForReveal(matePage, target.id);
  await shot(mate, 'teammate-revealed');
  check('1a  the click opens the chat holding the message, focused', opened);
  check(
    '1b  …pages back to a row older than the first page, in view',
    state1.rendered && state1.inView,
    JSON.stringify(state1)
  );
  check('1c  …highlighted', state1.revealed === true);
  check(
    '1d  …and the transcript is not at the bottom',
    state1.fromBottom > 200,
    `${state1.fromBottom}px`
  );
  await pushOne(author, workItemId, { sessionId: chats.A.id, content: `A new row ${stamp}` });
  await pushOne(author, workItemId, { sessionId: chats.A.id, content: `A newer row ${stamp}` });
  await matePage.waitForTimeout(2500);
  const after1 = await readRevealState(matePage, target.id);
  check(
    '1e  new rows do not pull the reader down',
    after1.rendered && after1.inView,
    JSON.stringify(after1)
  );
  await closeBell(mate);

  // 2. The reverse: the teammate writes in chat A and mentions the owner.
  const mateRow = expectStatus(
    await mate.api('POST', `${itemPath}/messages`, {
      content: `@owner over here ${stamp}`,
      message_type: 'text',
      session_id: chats.A.id,
    }),
    [200, 201],
    'the teammate’s message in chat A'
  );
  const excerpt2 = `@owner over here ${stamp}`;
  await mention(mate, workItemId, {
    userId: author.userId,
    excerpt: excerpt2,
    messageId: mateRow.id,
  });
  // Somewhere else first, so the reveal has to bring the chat forward.
  await chatTab(authorPage, labelB).click({ timeout: 30_000 });
  const row2 = await waitForBellRow(author, excerpt2);
  await row2.click();
  const ownerTabA = chatTab(authorPage, labelA);
  const ownerOpened = await waitFor(async () => isSelected(ownerTabA), 30_000, 'owner chat A').then(
    () => true,
    () => false
  );
  const state2 = await waitForReveal(authorPage, mateRow.id);
  await shot(author, 'owner-revealed');
  check('2a  the owner’s click brings the chat forward', ownerOpened);
  check(
    '2b  …with the teammate’s row revealed',
    state2.rendered && state2.inView && state2.revealed,
    JSON.stringify(state2)
  );
  await closeBell(author);

  // 3. The owner ends chat A (its tab's End session); a mention in it reopens it.
  await closeChatTab(authorPage, labelA, 'End session');
  await waitFor(async () => (await chatTab(authorPage, labelA).count()) === 0, 15_000, 'A closed');
  await waitFor(
    async () =>
      ((await author.api('GET', itemPath)).body?.sessions ?? []).some(
        (s) => s.id === chats.A.id && s.status === 'done'
      ),
    30_000,
    'chat A published as ended'
  );
  const endedRow = expectStatus(
    await mate.api('POST', `${itemPath}/messages`, {
      content: `@owner one more in the ended chat ${stamp}`,
      message_type: 'text',
      session_id: chats.A.id,
    }),
    [200, 201],
    'a message in the ended chat'
  );
  const excerpt3 = `@owner one more in the ended chat ${stamp}`;
  await mention(mate, workItemId, {
    userId: author.userId,
    excerpt: excerpt3,
    messageId: endedRow.id,
  });
  const row3 = await waitForBellRow(author, excerpt3);
  await row3.click();
  const reopened = await waitFor(
    async () => isSelected(chatTab(authorPage, labelA)),
    30_000,
    'the ended chat reopened'
  ).then(
    () => true,
    () => false
  );
  const state3 = await waitForReveal(authorPage, endedRow.id);
  // The composer's reason is its placeholder (the teammate's read-only composer, 8i).
  const endedComposer = await authorPage
    .locator('[data-testid="chat-thread"]:visible')
    .getByPlaceholder('This chat has ended.')
    .count();
  await shot(author, 'owner-ended-chat');
  check('3a  a mention in an ended chat reopens it as a tab, focused', reopened);
  check(
    '3b  …the row revealed, the composer closed',
    state3.revealed === true && state3.inView && endedComposer > 0,
    `${JSON.stringify(state3)} composer=${endedComposer}`
  );
  await closeBell(author);
  await authorPage.locator('[aria-label="New session"]').first().click();
  const endedEntry = authorPage.getByRole('menuitem').filter({ hasText: labelA });
  const listed = await endedEntry
    .first()
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false
    );
  const endedText = listed ? await endedEntry.first().innerText() : '';
  await shot(author, 'owner-plus-ended');
  check(
    '3c  the owner’s + lists the ended chat, marked Ended',
    endedText.includes('Ended'),
    endedText
  );
  await authorPage.keyboard.press('Escape');

  // 4. A message that is not there.
  const excerpt4 = `@teammate a message that is not there ${stamp}`;
  await mention(author, workItemId, {
    userId: mate.userId,
    excerpt: excerpt4,
    messageId: randomUUID(),
  });
  const row4 = await waitForBellRow(mate, excerpt4);
  await row4.click();
  const notice = matePage.locator('[data-testid="reveal-notice"]:visible');
  const said = await notice
    .first()
    .waitFor({ timeout: 30_000 })
    .then(
      () => true,
      () => false
    );
  const noticeText = said ? await notice.first().innerText() : '';
  await shot(mate, 'teammate-not-found');
  check(
    '4   a message that is not there says so in place',
    noticeText.includes('Couldn’t find that message.') ||
      noticeText.includes("Couldn't find that message."),
    JSON.stringify(noticeText)
  );
  await closeBell(mate);

  // 5. A row of no chat, with no chat tab open on the teammate's side: the
  //    newest chat that has not ended (B; A ended in 3).
  for (const label of [labelA, labelB]) {
    const tab = chatTab(matePage, label);
    if ((await tab.count()) > 0) await closeChatTab(matePage, label, 'Close tab');
  }
  const historyRow = await pushOne(author, workItemId, {
    sessionId: null,
    content: `Item history for everyone ${stamp}`,
  });
  const excerpt5 = `@teammate item history ${stamp}`;
  await mention(author, workItemId, {
    userId: mate.userId,
    excerpt: excerpt5,
    messageId: historyRow.id,
  });
  const row5 = await waitForBellRow(mate, excerpt5);
  await row5.click();
  const inB = await waitFor(async () => isSelected(chatTab(matePage, labelB)), 30_000, 'B').then(
    () => true,
    () => false
  );
  const state5 = await waitForReveal(matePage, historyRow.id);
  await shot(mate, 'teammate-history-row');
  check(
    '5   a row of no chat opens in the newest chat that has not ended, revealed',
    inB && state5.revealed === true && state5.inView,
    `B ${inB} ${JSON.stringify(state5)}`
  );
  await runTranscriptExperienceCheck({
    id: '6 ',
    account: mate,
    who: 'the teammate',
    typed: [`Item history for everyone ${stamp}`],
    results,
  });
  console.log(`(work item "${itemName}")`);
} catch (error) {
  runError = error;
  console.error(`ERROR  ${error.stack ?? error.message}`);
  await shot(author, 'error-author').catch(() => {});
  await shot(mate, 'error-teammate').catch(() => {});
} finally {
  const cleanupFailures = await cleanup.run();
  await mate.close();
  await author.close();
  const failures = results.failures() + cleanupFailures + (runError ? 1 : 0);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}
