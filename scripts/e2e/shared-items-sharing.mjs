#!/usr/bin/env node
/**
 * Shared-items step 3, H8 done-check with two real accounts: sharing from the
 * one Share dialog, and what the teammate sees.
 *
 *   0. The owner's app sent its repo's origin with the work item (H7).
 *   1. The header's Share opens the dialog with the open artifact under What.
 *   2. Inviting the teammate from the team roster shares that artifact.
 *   3. Copy link copies the https handoff for the artifact.
 *   4. Publish shows Confluence in the state this device and team call for
 *      (Connect when not connected).
 *   5. The teammate's sidebar lists the artifact-only share in the normal
 *      groups, with the owner's avatar and "1 artifact"; a click opens it.
 *   6. The work item itself answers them 403 ARTIFACTS_ONLY (chat).
 *   7. The owner @mentions the teammate: the bar says they can't see it, and
 *      Share · Can view lets them in; their row becomes the work item's.
 *   8. The teammate opens it and views the artifact: the owner's header
 *      stack rings them (a ring is someone viewing a file, use-viewing-presence.ts).
 *
 * Step 4 (S11) adds what the teammate's view is now made of: the artifact-only
 * share opens its work item scoped (5e-5i), and a member sees the owner's
 * header, rail and chats (8b-8g) and the artifact's status as the owner sets
 * it (8l, devstation-664), sharing-view checks in
 * sharing/teammate-view-checks.mjs; the teammate's composer shows the owner's
 * agent, model and mode, disabled (8i, sharing/teammate-composer-checks.mjs);
 * with six pending requests the chat's dock
 * scrolls and the transcript keeps half the thread (8h,
 * sharing/teammate-dock-checks.mjs); a teammate's comment is the owner's pin
 * and rail count, and a Can edit teammate's typing shows to the owner (9a-9c,
 * sharing/teammate-collab-checks.mjs); on an item with no chat published the
 * teammate is in the Work item chat tab, and present (9d-9e,
 * sharing/teammate-item-chat-checks.mjs); the teammate's @ menu offers a team
 * member not on the item only once it is open to the team (9g-9h,
 * sharing/teammate-mention-checks.mjs; needs a third team member); the owner in a chat rings for the
 * teammate, and in a split presence follows the focused pane (8j-8k, last,
 * sharing/teammate-presence-checks.mjs).
 *
 *   node scripts/e2e/build-e2e-app.mjs   # the app in .e2e-app/
 *   pnpm run dev:server                  # the sync server on :1234
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/shared-items-sharing.mjs
 *
 * Seed profiles as in artifact-sharing.mjs (CHORD_E2E_AUTHOR_PROFILE, default
 * `chord-b`; CHORD_E2E_TEAMMATE_PROFILE, default `chord-p1-smoke`). Check 7
 * sends one chat message, addressed to the teammate, which the owner's agent
 * must not answer (7e, sharing/owner-mention-reply-checks.mjs). Everything
 * created is removed at the end; exits non-zero on any failure, a cleanup
 * failure included. Screenshots: screenshots/e2e/shared-share-*.png.
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runOwnerMentionReplyCheck } from './sharing/owner-mention-reply-checks.mjs';
import { assertServerHealthy, launchAccount, waitFor } from './sharing/sharing-accounts.mjs';
import {
  createCleanup,
  createResults,
  expectStatus,
  findMemberId,
} from './sharing/sharing-fixtures.mjs';
import { runTeammateCollabChecks } from './sharing/teammate-collab-checks.mjs';
import { runTeammateComposerChecks } from './sharing/teammate-composer-checks.mjs';
import { runTeammateDockChecks } from './sharing/teammate-dock-checks.mjs';
import { runTeammateItemChatChecks } from './sharing/teammate-item-chat-checks.mjs';
import { runTeammateMentionChecks } from './sharing/teammate-mention-checks.mjs';
import { runTeammatePresenceChecks } from './sharing/teammate-presence-checks.mjs';
import { findFrameWith, followLink, SHOT_DIR } from './sharing/teammate-ui-helpers.mjs';
import { runScopedViewChecks, runTeammateViewChecks } from './sharing/teammate-view-checks.mjs';
import { publishPrototypeFromApp } from './sharing/viewing-checks.mjs';

const AUTHOR_PROFILE = process.env.CHORD_E2E_AUTHOR_PROFILE ?? 'chord-b';
const TEAMMATE_PROFILE = process.env.CHORD_E2E_TEAMMATE_PROFILE ?? 'chord-p1-smoke';
const SERVER_URL = process.env.VITE_CLOUD_API_URL.replace(/\/+$/, '');

await assertServerHealthy();
const results = createResults();
const { check } = results;
const cleanup = createCleanup();
const stamp = Date.now();

async function shot(account, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await account.instance.page.screenshot({ path: join(SHOT_DIR, `shared-share-${name}.png`) });
}

const settles = (promise) =>
  promise.then(
    () => true,
    () => false
  );

/** The work item open in the owner's app, its artifact's tab in focus (the rail's ARTIFACTS row). */
async function openArtifactTab(account, workItemId, artifactName) {
  const { page } = account.instance;
  await followLink(account, `chord://open/work-item/${workItemId}`);
  await page
    .getByRole('tab', { name: /^Work item/ })
    .first()
    .click({ timeout: 60_000 });
  await page.getByText(artifactName, { exact: true }).first().click({ timeout: 60_000 });
  await page.locator('[data-testid="file-bar"]').first().waitFor({ timeout: 30_000 });
}

/** The header's Share: enabled once the item is synced; opens the dialog. */
async function openShareDialog(page) {
  const share = page.getByRole('button', { name: 'Share', exact: true }).first();
  await waitFor(() => share.isEnabled(), 60_000, 'Share to be available');
  await share.click();
  const dialog = page.locator('[data-testid="share-dialog"]');
  await dialog.waitFor({ timeout: 30_000 });
  return dialog;
}

const author = await launchAccount({ seedProfile: AUTHOR_PROFILE, label: 'author' });
const mate = await launchAccount({ seedProfile: TEAMMATE_PROFILE, label: 'teammate' });
let runError = null;
try {
  if (author.userId === mate.userId) {
    throw new Error(`${AUTHOR_PROFILE} and ${TEAMMATE_PROFILE} are signed in to the same account`);
  }
  const { workItemId, artifactId, artifactPath, marker } = await publishPrototypeFromApp({
    author,
    mate,
    stamp,
    cleanup,
  });
  const artifactName = `P6 card ${stamp}`;
  const itemPath = `/work-items/${workItemId}`;
  const authorPage = author.instance.page;
  const matePage = mate.instance.page;

  // 0. The owner's app sent the repo's origin (create or startup backfill).
  const local = (await author.call('workItems.getAll')).items.find((w) => w.id === workItemId);
  const { remotes } = await author.call('repos.listRemotes');
  const origin = remotes.find((r) => r.repoId === local.repoId)?.remoteUrl ?? null;
  let cloudOrigin;
  const carried = await settles(
    waitFor(
      async () => {
        cloudOrigin = (await author.api('GET', itemPath)).body?.repo_remote_url ?? null;
        return cloudOrigin === origin;
      },
      60_000,
      'the cloud work item to carry the origin'
    )
  );
  check(
    "0   the cloud work item carries its repo's normalized origin",
    carried,
    `local ${origin}, cloud ${cloudOrigin}`
  );

  // 1. Share from the header, the artifact's tab open.
  await openArtifactTab(author, workItemId, artifactName);
  let dialog = await openShareDialog(authorPage);
  const what = await dialog.locator('[data-testid="share-scope"]').innerText();
  await shot(author, 'dialog');
  check('1   What preselects the open artifact', what.includes(artifactName), JSON.stringify(what));

  // 2. Invite from the team roster.
  const picker = dialog.getByPlaceholder(/^Add people from /);
  await picker.fill(mate.email);
  const option = dialog.locator('[role="option"]').filter({ hasText: mate.email }).first();
  const offered = await settles(option.waitFor({ timeout: 15_000 }));
  await shot(author, 'roster');
  check('2a  the roster offers the teammate', offered);
  if (!offered) throw new Error(`${mate.email} is not in the roster picker`);
  await option.click();
  let artifactMember;
  const invited = await settles(
    waitFor(
      async () => {
        const state = (await author.api('GET', `${artifactPath}/sharing`)).body;
        artifactMember = state?.members?.find((m) => m.email === mate.email);
        return !!artifactMember;
      },
      20_000,
      'the teammate to be a member of the artifact'
    )
  );
  check('2b  picking them shares the artifact', invited);
  if (!invited) throw new Error('the invite did not share the artifact');
  cleanup.add('remove the teammate from the artifact', () =>
    author.api('DELETE', `${artifactPath}/members/${artifactMember.id}`)
  );
  const mateName = artifactMember.name ?? mate.email;
  const listed = await settles(
    dialog
      .locator('[data-testid="share-people"]')
      .getByText(mateName)
      .first()
      .waitFor({ timeout: 10_000 })
  );
  check('2c  …and lists them under the people with access', listed);

  // 3. Copy link.
  await dialog.locator('[data-testid="share-copy-link"]').click();
  await authorPage.waitForTimeout(500);
  const copied = await author.instance.app.evaluate(({ clipboard }) => clipboard.readText());
  check(
    '3   Copy link copies the https handoff for the artifact',
    copied === `${SERVER_URL}/open/artifact/${artifactId}`,
    copied
  );
  // The handoff page is what a click in Slack or mail lands on: it opens the app.
  const handoff = await fetch(copied);
  const handoffHtml = await handoff.text();
  check(
    '3b  …which hands off to chord://open/artifact/<id>',
    handoff.status === 200 && handoffHtml.includes(`chord://open/artifact/${artifactId}`),
    `${handoff.status}`
  );

  // 4. Publish → Confluence, in the state this device and team call for.
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const panel = dialog.locator('[data-testid="publish-confluence"]');
  await panel.waitFor({ timeout: 30_000 });
  const teamId = expectStatus(await author.api('GET', `${artifactPath}/sharing`), 200, 'sharing')
    .team.id;
  const policy = expectStatus(
    await author.api('GET', `/organizations/${teamId}/sharing-policy`),
    200,
    'sharing policy'
  );
  // Not a Result: the connection status itself (confluence-connection.ts).
  const connection = await author.instance.rpc('confluence.checkConnection');
  const expected = !policy.allow_confluence_publishing
    ? ['policy_off']
    : !connection.connected
      ? ['not_connected']
      : ['unpublished', 'published', 'out_of_date', 'edited'];
  let state = null;
  await settles(
    waitFor(
      async () => {
        state = await panel.getAttribute('data-state');
        return expected.includes(state);
      },
      30_000,
      'the Confluence state'
    )
  );
  const connectShown =
    state !== 'not_connected' ||
    (await dialog.getByRole('button', { name: 'Connect Confluence' }).isVisible());
  await shot(author, 'publish');
  check(
    '4   Publish shows Confluence as this device and team call for (Connect when not connected)',
    expected.includes(state) && connectShown,
    `state ${state}, expected ${expected.join('|')}`
  );
  await authorPage.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });

  // 5. The teammate's sidebar: the artifact-only share, owner's avatar, "1 artifact".
  const header = expectStatus(
    await mate.api('GET', `${itemPath}?include=artifacts`),
    200,
    'the header'
  );
  const ownerName = header.creator_name ?? header.creator_email;
  const itemName = header.name;
  const row = matePage.locator('[data-sidebar-row]').filter({ hasText: itemName }).first();
  const rowShown = await settles(row.waitFor({ timeout: 45_000 }));
  const rowText = rowShown ? await row.innerText() : '';
  const avatar = rowShown ? await row.locator(`[title="Shared by ${ownerName}"]`).count() : 0;
  await shot(mate, 'sidebar-artifact-row');
  check('5a  the teammate sidebar lists the artifact-only share', rowShown);
  check('5b  …wearing the owner’s avatar', avatar === 1, `Shared by ${ownerName}`);
  check('5c  …as "1 artifact"', rowText.includes('1 artifact'), JSON.stringify(rowText));
  if (rowShown) {
    await row.click();
    const opened = (await findFrameWith(matePage, marker, 60_000)) !== null;
    await shot(mate, 'sidebar-artifact-opened');
    check('5d  a click opens the artifact', opened);
    await runScopedViewChecks({ mate, ownerName, results, shot });
  }

  // 6. The work item's chat is refused as artifacts only.
  const chat = await mate.api('GET', `${itemPath}/messages`);
  check(
    '6   chat answers 403 ARTIFACTS_ONLY',
    chat.status === 403 && chat.body?.code === 'ARTIFACTS_ONLY',
    `${chat.status} ${JSON.stringify(chat.body)}`
  );

  // 7. The owner @mentions the teammate, who can't see the work item.
  await followLink(author, `chord://open/work-item/${workItemId}`);
  // The artifact's tab kept focus; the chat's tab is the one a session ends from.
  await authorPage
    .locator('[aria-label^="End session "]')
    .first()
    .locator('xpath=ancestor::*[@title][1]')
    .click({ position: { x: 24, y: 12 }, timeout: 30_000 });
  const composer = authorPage.getByPlaceholder(/^Message the agent/).first();
  await composer.waitFor({ timeout: 30_000 });
  await composer.click();
  await composer.pressSequentially(`@${mateName.split(/[\s@]/)[0]}`);
  const menuRow = authorPage.locator('.floating-surface-solid > div').filter({ hasText: mateName });
  const inMenu = await settles(menuRow.first().waitFor({ timeout: 20_000 }));
  check('7a  the owner’s mention menu offers the teammate', inMenu);
  if (!inMenu) throw new Error(`${mateName} is not in the mention menu`);
  await menuRow.first().dispatchEvent('mousedown');
  const mention = { text: `can you review the card? ref-${stamp}`, marker: `ref-${stamp}` };
  await composer.pressSequentially(` ${mention.text}`);
  await composer.press('Enter');
  mention.sentAt = Date.now();
  const bar = authorPage.locator('[data-testid="mention-share-bar"]');
  const asked = await settles(bar.waitFor({ timeout: 15_000 }));
  const barText = asked ? await bar.innerText() : '';
  await shot(author, 'mention-bar');
  check(
    '7b  the bar says they can’t see the work item',
    barText.includes(mateName) && barText.includes("can't see this work item"),
    JSON.stringify(barText)
  );
  if (!asked) throw new Error('the mention share bar did not show');
  await bar.getByRole('button', { name: 'Share · Can view' }).click();
  const letIn = await settles(
    waitFor(
      async () => (await mate.api('GET', itemPath)).body?.access_scope === 'work_item',
      20_000,
      'the teammate to reach the work item'
    )
  );
  check('7c  Share · Can view lets them in', letIn);
  if (letIn) {
    const memberId = await findMemberId(author, itemPath, mate.email);
    cleanup.add('remove the teammate from the work item', () =>
      author.api('DELETE', `${itemPath}/members/${memberId}`)
    );
  }
  const becameItem = await settles(
    waitFor(
      async () => rowShown && !(await row.innerText()).includes('artifact'),
      45_000,
      'the row to become the work item'
    )
  );
  check('7d  the teammate’s row becomes the work item’s', becameItem);
  await runOwnerMentionReplyCheck({ author, mention, results, shot });

  // 8. The teammate opens it and views the artifact; the owner's header rings them.
  await followLink(mate, `chord://open/work-item/${workItemId}`);
  await settles(
    matePage
      .locator('[data-testid="work-item-header"]')
      .getByText(`Shared by ${ownerName}`)
      .first()
      .waitFor({ timeout: 45_000 })
  );
  await matePage.getByText(artifactName, { exact: true }).first().click({ timeout: 30_000 });
  await findFrameWith(matePage, marker, 60_000);
  const ring = authorPage.locator('[data-testid="header-avatar-stack"] [data-viewing="true"]');
  const ringed = await settles(ring.first().waitFor({ timeout: 45_000 }));
  await shot(author, 'header-ring');
  await shot(mate, 'item-opened');
  check('8   the owner’s header stack rings the teammate viewing it', ringed);
  await runTeammateViewChecks({ author, mate, artifactId, ownerName, results, shot });
  await runTeammateComposerChecks({ author, mate, workItemId, results, shot });
  await runTeammateDockChecks({ author, mate, workItemId, stamp, cleanup, results, shot });
  await runTeammateCollabChecks({
    author,
    mate,
    workItemId,
    stamp,
    cleanup,
    results,
    shot,
  });
  const { org_id: orgId } = expectStatus(await author.api('GET', itemPath), 200, 'the work item');
  await runTeammateItemChatChecks({ author, mate, orgId, stamp, cleanup, results, shot });
  await runTeammateMentionChecks({ author, mate, orgId, stamp, cleanup, results, shot });
  await runTeammatePresenceChecks({
    author,
    mate,
    workItemId,
    artifactId,
    artifactName,
    results,
    shot,
  });
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
