#!/usr/bin/env node
/**
 * Shared-items step 2, N5 done-check with two real accounts: notifications
 * are facts the app turns into sentences, and each opens the right place.
 *
 *   1. The author shares one artifact: the teammate's row names the author
 *      (never the email) and says "from <work item>"; a click opens it.
 *   2. The author shares the work item: "<author> shared <item>", "<repo> ·
 *      Can edit"; a click opens the work item.
 *   3. A chat @mention: the row carries the excerpt.
 *   4. The teammate comments and replies: the author gets "commented on"; a
 *      click on the reply opens the artifact's comments card on its thread.
 *   5. Settings → "Comment on your artifact" in-app off hides the next one
 *      from the bell and the unread count; on again, it is back.
 *   6. A mention sent while the teammate's socket is down shows once it
 *      reconnects, not at the next minute's poll.
 *
 *   node scripts/e2e/build-e2e-app.mjs   # the app in .e2e-app/
 *   pnpm run dev:server                  # the sync server on :1234
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/shared-items-notifications.mjs
 *
 * Seed profiles as in artifact-sharing.mjs (CHORD_E2E_AUTHOR_PROFILE, default
 * `chord-b`; CHORD_E2E_TEAMMATE_PROFILE, default `chord-p1-smoke`). Everything
 * created is removed at the end; exits non-zero on any failure, a cleanup
 * failure included. Screenshots: screenshots/e2e/shared-notify-*.png.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  bellRowCount,
  bellUnreadCount,
  closeBell,
  closeRendererSockets,
  shot,
  waitForBellRow,
  waitForServerNotification,
} from './sharing/notification-helpers.mjs';
import { assertServerHealthy, launchAccount, waitFor } from './sharing/sharing-accounts.mjs';
import { createCleanup, createResults, expectStatus } from './sharing/sharing-fixtures.mjs';
import { findFrameWith } from './sharing/teammate-ui-helpers.mjs';
import { publishPrototypeFromApp } from './sharing/viewing-checks.mjs';

const AUTHOR_PROFILE = process.env.CHORD_E2E_AUTHOR_PROFILE ?? 'chord-b';
const TEAMMATE_PROFILE = process.env.CHORD_E2E_TEAMMATE_PROFILE ?? 'chord-p1-smoke';

await assertServerHealthy();
const results = createResults();
const { check } = results;
const cleanup = createCleanup();
const stamp = Date.now();

const author = await launchAccount({ seedProfile: AUTHOR_PROFILE, label: 'author' });
const mate = await launchAccount({ seedProfile: TEAMMATE_PROFILE, label: 'teammate' });
let runError = null;
try {
  if (author.userId === mate.userId) {
    throw new Error(`${AUTHOR_PROFILE} and ${TEAMMATE_PROFILE} are signed in to the same account`);
  }
  const published = await publishPrototypeFromApp({ author, mate, stamp, cleanup });
  const { workItemId, artifactId, artifactPath, marker } = published;
  const artifactName = `P6 card ${stamp}`;
  const item = expectStatus(await author.api('GET', `/work-items/${workItemId}`), 200, 'item');
  const itemName = item.name;
  const itemPath = `/work-items/${workItemId}`;
  const authorPage = author.instance.page;
  const matePage = mate.instance.page;

  // 1. One artifact shared.
  expectStatus(
    await author.api('POST', `${artifactPath}/members`, { email: mate.email, role: 'view' }),
    201,
    'share the artifact'
  );
  const artifactShare = await waitForServerNotification(
    mate,
    (n) => n.type === 'shared_with_you' && n.artifact_id === artifactId,
    'the artifact share on the server'
  );
  const authorName = artifactShare.actor_name;
  check('1a  the share names its author', !!authorName, `actor_name ${authorName}`);
  const artifactRow = await waitForBellRow(mate, artifactName);
  const artifactRowText = await artifactRow.innerText();
  await shot(mate, 'artifact-share');
  check(
    '1b  the row reads "<author> shared <artifact>", "from <item> · Can view"',
    artifactRowText.includes(`${authorName} shared ${artifactName}`) &&
      artifactRowText.includes(`from ${itemName} · Can view`),
    JSON.stringify(artifactRowText)
  );
  check('1c  …and never shows the email', !artifactRowText.includes(author.email));
  await artifactRow.click();
  const frame = await findFrameWith(matePage, marker, 60_000);
  check('1d  a click opens the shared artifact', frame !== null);
  await shot(mate, 'artifact-share-opened');

  // 2. The work item shared.
  const member = expectStatus(
    await author.api('POST', `${itemPath}/members`, { email: mate.email, role: 'edit' }),
    201,
    'share the work item'
  );
  cleanup.add('remove the teammate from the work item', () =>
    author.api('DELETE', `${itemPath}/members/${member.id}`)
  );
  const itemShare = await waitForServerNotification(
    mate,
    (n) => n.type === 'shared_with_you' && n.work_item_id === workItemId && !n.artifact_id,
    'the work-item share on the server'
  );
  const itemRow = await waitForBellRow(mate, `${authorName} shared ${itemName}`);
  const itemRowText = await itemRow.innerText();
  await shot(mate, 'item-share');
  const repoPart = itemShare.work_item_repo_name ? `${itemShare.work_item_repo_name} · ` : '';
  check(
    '2a  the row reads "<author> shared <item>", "<repo> · Can edit"',
    itemRowText.includes(`${repoPart}Can edit`) && !itemRowText.includes(author.email),
    JSON.stringify(itemRowText)
  );
  // The artifact opened alone (1d) holds the work item's room, which the
  // server refused while only the artifact was shared; the share must lift
  // that, or the item opens on "You don't have access".
  await itemRow.click();
  // The teammate's header names the owner: the item itself, not a card about it.
  const sharedBy = matePage
    .locator('[data-testid="work-item-header"]')
    .getByText(`Shared by ${authorName}`);
  const noAccess = matePage.getByText("You don't have access to this work item");
  let itemState = 'loading';
  await waitFor(
    async () => {
      if (await noAccess.isVisible()) itemState = 'no access';
      else if (await sharedBy.first().isVisible()) itemState = 'opened';
      return itemState !== 'loading';
    },
    30_000,
    'the shared work item'
  ).catch(() => {});
  await matePage.waitForTimeout(3000);
  if (itemState === 'opened' && (await noAccess.isVisible())) itemState = 'no access';
  await shot(mate, 'item-share-opened');
  check('2b  a click opens the work item, shared by its author', itemState === 'opened', itemState);
  const railText = await matePage.locator('body').innerText();
  check('2c  its rail says how long ago once ("agoago" was a bug)', !railText.includes('agoago'));

  // 3. A chat @mention (the app sends it after the message is saved; N2).
  const excerpt = `@teammate can you check the CTA? ${stamp}`;
  expectStatus(
    await author.api('POST', `${itemPath}/mentions`, {
      user_ids: [mate.userId],
      excerpt,
      message_id: randomUUID(),
    }),
    201,
    'mention the teammate'
  );
  const mentionRow = await waitForBellRow(mate, `${authorName} mentioned you in ${itemName}`);
  const mentionText = await mentionRow.innerText();
  await shot(mate, 'mention');
  check('3a  a chat mention carries its excerpt', mentionText.includes(excerpt), mentionText);
  await closeBell(mate);

  // 4. The teammate comments twice and replies to the first comment.
  const first = expectStatus(
    await mate.api('POST', `${artifactPath}/comments`, { body: `First note ${stamp}` }),
    201,
    'first comment'
  );
  expectStatus(
    await mate.api('POST', `${artifactPath}/comments`, { body: `Second note ${stamp}` }),
    201,
    'second comment'
  );
  const replyBody = `Reply to the first ${stamp}`;
  const reply = expectStatus(
    await mate.api('POST', `${artifactPath}/comments`, {
      body: replyBody,
      parent_comment_id: first.id,
    }),
    201,
    'reply'
  );
  const mateName = (
    await waitForServerNotification(
      author,
      (n) => n.type === 'artifact_comment' && n.comment_id === reply.id,
      'the reply notification on the server'
    )
  ).actor_name;
  const replyRow = await waitForBellRow(author, replyBody);
  const replyText = await replyRow.innerText();
  await shot(author, 'comment');
  check(
    '4a  the author reads "<teammate> commented on <artifact>" with the excerpt',
    !!mateName && replyText.includes(`${mateName} commented on ${artifactName}`),
    JSON.stringify(replyText)
  );
  await replyRow.click();
  const selected = authorPage.locator(
    '[data-testid="comments-card"] [data-comment-thread][data-selected="true"]'
  );
  const threadShown = await waitFor(
    async () => {
      if ((await selected.count()) === 0) return false;
      const text = await selected.first().innerText();
      return text.includes(`First note ${stamp}`) && text.includes(replyBody);
    },
    45_000,
    'the comments card on the replied thread'
  ).then(
    () => true,
    () => false
  );
  await shot(author, 'comment-opened');
  check('4b  a click opens the comments card on the thread holding the reply', threadShown);

  // 5. "Comment on your artifact" off in Settings hides the next one.
  const unreadBefore = await bellUnreadCount(author);
  await closeBell(author);
  const inAppSwitch = authorPage.locator('[aria-label="Comment on your artifact: in-app"]');
  await authorPage.click('[title="Settings"]');
  await authorPage.getByRole('button', { name: 'Interface', exact: true }).first().click();
  await inAppSwitch.waitFor({ timeout: 30_000 });
  await inAppSwitch.click();
  await waitFor(
    async () => (await inAppSwitch.getAttribute('aria-checked')) === 'false',
    10_000,
    'the in-app switch off'
  );
  await shot(author, 'settings-off');
  const hiddenBody = `Hidden note ${stamp}`;
  const hidden = expectStatus(
    await mate.api('POST', `${artifactPath}/comments`, { body: hiddenBody }),
    201,
    'comment while switched off'
  );
  await waitForServerNotification(
    author,
    (n) => n.type === 'artifact_comment' && n.comment_id === hidden.id,
    'the hidden comment notification on the server'
  );
  await authorPage.waitForTimeout(3000);
  const hiddenRows = await bellRowCount(author, hiddenBody);
  const unreadWhileOff = await bellUnreadCount(author);
  await shot(author, 'bell-switched-off');
  check(
    '5a  with the switch off, the bell neither lists nor counts it',
    hiddenRows === 0 && unreadWhileOff <= unreadBefore,
    `rows ${hiddenRows}, unread ${unreadBefore} → ${unreadWhileOff}`
  );
  await closeBell(author);
  await inAppSwitch.click();
  await waitFor(
    async () => (await inAppSwitch.getAttribute('aria-checked')) === 'true',
    10_000,
    'the in-app switch on'
  );
  const back = await waitForBellRow(author, hiddenBody, 15_000).then(
    () => true,
    () => false
  );
  check('5b  switched back on, it is listed again (hidden, never lost)', back);

  // 6. A notification sent while the socket is down is not held back until
  //    the next minute's poll: the list is read again on reconnect. The
  //    renderer's socket is closed from DevTools; the provider reconnects 3s
  //    later, and the mention lands in that gap.
  const closed = await closeRendererSockets(matePage);
  const gapExcerpt = `@teammate while you reconnected ${stamp}`;
  expectStatus(
    await author.api('POST', `${itemPath}/mentions`, {
      user_ids: [mate.userId],
      excerpt: gapExcerpt,
      message_id: randomUUID(),
    }),
    201,
    'mention while the socket is down'
  );
  const reconnected = await waitForBellRow(mate, gapExcerpt, 12_000).then(
    () => true,
    () => false
  );
  await shot(mate, 'after-reconnect');
  check(
    '6   a mention sent while the socket was down shows once it reconnects',
    closed > 0 && reconnected,
    `closed ${closed} socket(s)`
  );
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
