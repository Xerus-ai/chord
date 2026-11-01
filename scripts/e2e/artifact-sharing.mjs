#!/usr/bin/env node
/**
 * P6 sharing done-check with two real accounts (plan 2026-09-23 §4 P6, design
 * the P6 sharing design §9).
 *
 *   pnpm exec electron-vite build        # the app in out/, run twice side by side
 *   pnpm run dev:server                  # the sync server (or the full `pnpm run dev`)
 *   node scripts/e2e/artifact-sharing.mjs
 *
 * Seed profiles (each already signed in; chord-multiplayer-test skill):
 *   CHORD_E2E_AUTHOR_PROFILE    (default `chord-b`)        owner of a team the teammate is in
 *   CHORD_E2E_TEAMMATE_PROFILE  (default `chord-p1-smoke`) the second account
 *
 * Checks 1–9 are the plan's; 10 is the viewing model: a teammate views a
 * prototype with the author's app closed. 11–17 are format coverage (design
 * §10): a web page, an MDX page and a pdf, docx, pptx and png published from
 * the author's app, read by the teammate over REST and in their own app with
 * the author's app closed, plus a shared document, a public pdf in the app and
 * the artifact-only row in the teammate's sidebar. 18 is the share notification in the
 * teammate's app, 20 the same after the teammate's app is relaunched (history
 * only); 19 is the author's "won't load for viewers" toast. Every
 * check asserts on rendered content or a refused action, never on a frame or
 * status alone. Everything created is removed at the end; a cleanup failure
 * is reported and fails the run. Exits non-zero on any failure.
 */
import 'dotenv/config';
import { runSeatCheck, runTeamAccessCheck, runWorkItemChecks } from './sharing/access-checks.mjs';
import { runViewWarningToastCheck } from './sharing/author-ui-checks.mjs';
import { publishFormatsFromApp, runFormatApiChecks } from './sharing/format-checks.mjs';
import { assertServerHealthy, launchAccount } from './sharing/sharing-accounts.mjs';
import { createCleanup, createResults, expectStatus } from './sharing/sharing-fixtures.mjs';
import { runTeammateFormatViewChecks } from './sharing/teammate-format-checks.mjs';
import {
  prepareTeammateUiChecks,
  runNotificationClickCheck,
  runPublicFileChecks,
  runSidebarCheck,
  runTeammateDocumentCheck,
} from './sharing/teammate-ui-checks.mjs';
import {
  publishPrototypeFromApp,
  runArtifactAloneCheck,
  runPublicDocumentCheck,
  runPublicPageCheck,
  runTeammateAppViewCheck,
} from './sharing/viewing-checks.mjs';

const AUTHOR_PROFILE = process.env.CHORD_E2E_AUTHOR_PROFILE ?? 'chord-b';
const TEAMMATE_PROFILE = process.env.CHORD_E2E_TEAMMATE_PROFILE ?? 'chord-p1-smoke';

await assertServerHealthy();
const results = createResults();
const cleanup = createCleanup();
const stamp = Date.now();

const author = await launchAccount({ seedProfile: AUTHOR_PROFILE, label: 'author' });
let mate = await launchAccount({ seedProfile: TEAMMATE_PROFILE, label: 'teammate' });
let runError = null;
try {
  if (author.userId === mate.userId) {
    throw new Error(`${AUTHOR_PROFILE} and ${TEAMMATE_PROFILE} are signed in to the same account`);
  }
  const [authorOrgs, mateOrgs] = await Promise.all([
    author.api('GET', '/organizations').then((r) => expectStatus(r, 200, 'author teams')),
    mate.api('GET', '/organizations').then((r) => expectStatus(r, 200, 'teammate teams')),
  ]);
  const team = authorOrgs.find(
    (o) => o.role === 'owner' && mateOrgs.some((m) => m.org_id === o.org_id)
  );
  if (!team) throw new Error(`${author.email} owns no team that ${mate.email} belongs to`);
  const outside =
    mateOrgs.find((o) => o.role === 'owner' && !authorOrgs.some((a) => a.org_id === o.org_id)) ??
    null;
  console.log(`author ${author.email}, teammate ${mate.email}, team "${team.name}"`);

  const context = { author, mate, team, outside, stamp, results, cleanup };
  const doc = await runWorkItemChecks(context);
  await runTeamAccessCheck(context);
  await runSeatCheck({ ...context, workItemId: doc.workItemId });

  const published = await publishPrototypeFromApp(context);
  const formats = await publishFormatsFromApp({ ...context, published });
  await runViewWarningToastCheck({ ...context, formats });
  await runArtifactAloneCheck({ ...context, published });
  const pageToken = await runPublicPageCheck({ ...context, published });
  await runPublicDocumentCheck({ ...context, doc, pageToken });
  await runFormatApiChecks({ ...context, formats });
  const pdfToken = await prepareTeammateUiChecks({ ...context, doc, formats });
  // Closes the author's app: everything from here renders from what was uploaded.
  await runTeammateAppViewCheck({ ...context, published });
  await runTeammateFormatViewChecks({ ...context, formats });
  await runTeammateDocumentCheck({ ...context, doc });
  await runPublicFileChecks({ ...context, pdfToken });
  await runSidebarCheck({ ...context, formats });
  const byKind = Object.fromEntries(formats.entries.map((entry) => [entry.kind, entry]));
  await runNotificationClickCheck({
    ...context,
    number: 18,
    entry: byKind.mdx,
    why: 'received live',
  });
  // A fresh app has no live frames: the notification list is the server's
  // history alone, and clicking a row must still open the artifact.
  await mate.close();
  mate = await launchAccount({ seedProfile: TEAMMATE_PROFILE, label: 'teammate-restarted' });
  await runNotificationClickCheck({
    ...context,
    mate,
    number: 20,
    entry: byKind.web,
    why: 'after a restart, from history',
  });
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
