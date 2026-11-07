#!/usr/bin/env node
/**
 * Shared-items step 1, S8 done-check with two real accounts: the rail's
 * unread dot. Unread is kept per account in the cloud (step 1 plan §4
 * question 2), so it needs a teammate: their comment shows the dot on the
 * author's ARTIFACTS row, and opening the comments card from the rail clears
 * it, in the app and on the server.
 *
 *   node scripts/e2e/lib/build-e2e-app.mjs   # the app in .e2e-app/
 *   pnpm run dev:server                  # the sync server on :1234
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/suites/shared-items-rail-unread.mjs
 *
 * Seed profiles as in artifact-sharing.mjs: CHORD_E2E_AUTHOR_PROFILE (default
 * `chord-b`) owns a team CHORD_E2E_TEAMMATE_PROFILE (default `chord-p1-smoke`)
 * is in. Everything created is removed at the end; exits non-zero on any
 * failure, a cleanup failure included.
 */
import 'dotenv/config';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';
import { createCleanup, createResults, expectStatus } from '../lib/sharing/sharing-fixtures.mjs';
import { screenshot } from '../lib/sharing/teammate-ui-helpers.mjs';
import { publishPrototypeFromApp } from '../lib/sharing/viewing-checks.mjs';

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
  const { workItemId, artifactId, artifactPath } = published;
  expectStatus(
    await author.api('POST', `${artifactPath}/members`, { email: mate.email, role: 'view' }),
    201,
    'share the artifact with the teammate'
  );

  const page = author.instance.page;
  const { items } = await author.call('workItems.getAll');
  const workItem = items.find((w) => w.id === workItemId);
  await page.getByText(workItem.name, { exact: true }).first().click();
  const counts = page.locator(
    `[data-testid="artifact-rail-counts"][data-artifact-id="${artifactId}"]`
  );
  // ARTIFACTS lives on the rail's Work item panel. The rail can land on
  // another panel as the work item loads (Changes, with uncommitted files),
  // where the rows are mounted but hidden, so it is asked again until shown.
  const showCounts = () =>
    waitFor(
      async () => {
        if (await counts.isVisible()) return true;
        await page
          .getByRole('tab', { name: /^Work item/ })
          .first()
          .click();
        return false;
      },
      30_000,
      'the ARTIFACTS row on the Work item panel'
    );
  await page.waitForTimeout(3000);
  await screenshot(author, 's8-rail-opened');
  await showCounts();
  check(
    'before anyone else comments, the row has no unread dot',
    (await counts.getAttribute('data-unread')) === 'false'
  );

  expectStatus(
    await mate.api('POST', `${artifactPath}/comments`, { body: `S8 teammate comment ${stamp}` }),
    201,
    'teammate comments'
  );
  const dotShown = await waitFor(
    async () => (await counts.getAttribute('data-unread')) === 'true',
    30_000,
    'the unread dot'
  ).then(
    () => true,
    () => false
  );
  check('the teammate’s comment shows the unread dot on the author’s row', dotShown);
  await showCounts();
  await screenshot(author, 's8-rail-unread');

  await counts.locator('button[title="Open comments"]').click();
  const card = page.locator('[data-testid="comments-card"]');
  const cardShown = await card
    .getByText(`S8 teammate comment ${stamp}`)
    .waitFor({ timeout: 20_000 })
    .then(
      () => true,
      () => false
    );
  check('clicking 💬 opens the comments card with the teammate’s comment', cardShown);

  const dotCleared = await waitFor(
    async () => (await counts.getAttribute('data-unread')) === 'false',
    30_000,
    'the unread dot to clear'
  ).then(
    () => true,
    () => false
  );
  const summary = expectStatus(
    await author.api('GET', `/work-items/${workItemId}/artifact-summary`),
    200,
    'author summary'
  );
  const row = summary.find((r) => r.artifact_id === artifactId);
  check(
    'opening the card clears the dot, in the app and on the server',
    dotCleared && row?.unread === false && row?.open_comments >= 1,
    JSON.stringify(row)
  );
  await screenshot(author, 's8-rail-read');
} catch (error) {
  runError = error;
  console.error(`ERROR  ${error.stack ?? error.message}`);
} finally {
  const cleanupFailures = await cleanup.run();
  await mate.close();
  await author.close();
  const failures = results.failures() + cleanupFailures + (runError ? 1 : 0);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}
