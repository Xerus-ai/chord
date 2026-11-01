/**
 * The teammate's own app, with the author's app CLOSED (design 2026-09-24
 * §9–§10): a shared document opens read-only for Can view — a keystroke into
 * it changes nothing, locally or in the live document; a public link the
 * teammate reaches opens as its tab in the app; the sidebar row of an artifact-only share and the share
 * notification each open their artifact. Each check leaves a screenshot in
 * screenshots/e2e. Check 14 (formats) is teammate-format-checks.mjs.
 */
import { fetchSignedOut, waitFor } from './sharing-accounts.mjs';
import { expectStatus, readLinkToken } from './sharing-fixtures.mjs';
import {
  assertNotShowing,
  describePdfLoad,
  findFrameWith,
  followLink,
  pdfFrameIsUnsandboxed,
  screenshot,
  screenshotComposited,
  waitForPdfDocument,
} from './teammate-ui-helpers.mjs';

/**
 * The author's side of checks 15 and 16, done while the author's app is still
 * open: the document shared alone as Can view, and the pdf made public.
 * Returns the pdf's public link token.
 */
export async function prepareTeammateUiChecks({ author, mate, doc, formats }) {
  const docPath = `/work-items/${doc.workItemId}/artifacts/${doc.docId}`;
  expectStatus(
    await author.api('POST', `${docPath}/members`, { email: mate.email, role: 'view' }),
    201,
    'share the document alone'
  );
  const pdf = formats.entries.find((entry) => entry.kind === 'pdf');
  expectStatus(
    await author.api('PATCH', `${pdf.artifactPath}/general-access`, {
      general_access: 'link',
      general_role: 'view',
    }),
    200,
    'make the pdf public'
  );
  return readLinkToken(author, pdf.artifactPath);
}

/**
 * Check 15: a shared document opened in the teammate's app is read-only for
 * Can view — the editor says so, and typing into it reaches neither the
 * editor's text nor the live document.
 */
export async function runTeammateDocumentCheck({ mate, doc, stamp, results }) {
  const { check } = results;
  await followLink(mate, `chord://open/artifact/${doc.docId}`);
  const editor = mate.instance.page.locator('.ProseMirror').first();
  const readEditor = () =>
    editor
      .evaluate((el) => ({ text: el.innerText, editable: el.getAttribute('contenteditable') }))
      .catch(() => ({ text: '', editable: 'missing' }));
  let state = { text: '', editable: 'missing' };
  await waitFor(
    async () => {
      state = await readEditor();
      return state.text.includes(doc.seed);
    },
    60_000,
    'the shared document in the editor'
  ).catch(() => {});
  check('15a  the shared document opens in the teammate app', state.text.includes(doc.seed));
  check(
    '15b  …and the editor is read-only for Can view',
    state.editable === 'false',
    `contenteditable ${state.editable}`
  );
  if (!state.text.includes(doc.seed)) {
    await screenshot(mate, 'shared-document');
    return;
  }

  const typed = `VIEWER-TYPED-${stamp}`;
  await editor.click({ position: { x: 20, y: 10 } });
  await mate.instance.page.keyboard.press('End');
  await mate.instance.page.keyboard.type(typed);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const after = await readEditor();
  await screenshot(mate, 'shared-document');
  check('15c  …typing into it changes nothing on screen', !after.text.includes(typed));
  const live = await mate.openDocument(doc.docId);
  check(
    '15d  …nor in the live document',
    live.synced && !live.readText().includes(typed),
    `synced=${live.synced}`
  );
  live.destroy();
}

/**
 * Check 16: the public pdf link — signed out, and in the app. The teammate
 * reaches the pdf, so the app resolves the link (GET /public-links/:token/
 * resolve) and opens it as a tab of its work item (step 4, S10).
 */
export async function runPublicFileChecks({ mate, pdfToken: token, results }) {
  const { check } = results;
  const host = await fetchSignedOut(`/p/${token}`);
  check(
    '16a  the public pdf is framed without the sandbox attribute',
    host.status === 200 && host.text.includes(`<iframe src="/p/${token}/file"`)
  );
  const file = await fetchSignedOut(`/p/${token}/file`);
  const csp = file.headers.get('content-security-policy') ?? '';
  check(
    '16b  …served as a pdf under the frame sandbox',
    file.status === 200 &&
      file.headers.get('content-type') === 'application/pdf' &&
      csp.includes('sandbox'),
    `${file.status} ${file.headers.get('content-type')}`
  );

  await followLink(mate, `chord://open/p/${token}`);
  const inApp = await waitForPdfDocument(mate);
  await screenshotComposited(mate, 'public-pdf-in-app');
  check(
    '16c  the public pdf link opens its tab in the app, for a teammate who reaches it',
    inApp.pages === 1,
    describePdfLoad(inApp)
  );
  check(
    '16d  …in a frame without the sandbox attribute',
    await pdfFrameIsUnsandboxed(mate.instance.page)
  );
}

/**
 * Check 17: a work item reached only through artifacts shared alone is a row
 * in the teammate's normal sidebar groups (shared-items step 3, H7): the
 * owner's avatar and "N artifacts"; a click expands it to one child row per
 * artifact, and a child opens its artifact. The app is left showing a
 * different artifact first, so the frame found afterwards can only have come
 * from the click.
 */
export async function runSidebarCheck({ mate, formats, results }) {
  const { check } = results;
  const { page } = mate.instance;
  const docx = formats.entries.find((entry) => entry.kind === 'docx');
  const web = formats.entries.find((entry) => entry.kind === 'web');
  await followLink(mate, `chord://open/artifact/${web.artifactId}`);
  if (!(await findFrameWith(page, web.marker))) throw new Error('the web page did not open');
  await assertNotShowing(page, docx.marker, 'the docx');

  const header = expectStatus(
    await mate.api('GET', `/work-items/${formats.workItemId}?include=artifacts`),
    200,
    'the artifact-only header'
  );
  const count = header.shared_artifacts.length;
  const ownerName = header.creator_name ?? header.creator_email;
  const row = page.locator('[data-sidebar-row]').filter({ hasText: header.name }).first();
  const listed = await row
    .waitFor({ timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  const text = listed ? await row.innerText() : '';
  const avatar = listed ? await row.locator(`[title="Shared by ${ownerName}"]`).count() : 0;
  check(
    `17a  the sidebar lists the artifact-only share as "${count} artifacts" with the owner's avatar`,
    listed && count > 1 && text.includes(`${count} artifacts`) && avatar === 1,
    JSON.stringify(text)
  );
  if (!listed) {
    await screenshot(mate, 'sidebar-open');
    return;
  }
  await row.click();
  const child = page.getByRole('button', { name: docx.name, exact: true }).first();
  const expanded = await child
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (expanded) await child.click();
  const frame = expanded ? await findFrameWith(page, docx.marker) : null;
  await screenshot(mate, 'sidebar-open');
  check('17b  …expands to one row per artifact, and a row opens its artifact', frame !== null);
}

/**
 * Checks 18 and 20: the share notification in the teammate's app — the bell
 * opens the list, the row names the artifact, and clicking it opens the
 * artifact, which is not on screen before the click. 18 runs in the app that
 * received the share live; 20 in a freshly launched app, where the row comes
 * from the server's history alone.
 */
export async function runNotificationClickCheck({ author, mate, results, number, entry, why }) {
  const { check } = results;
  const { page } = mate.instance;
  await assertNotShowing(page, entry.marker, `the ${entry.kind} page`);

  await page.locator('button[aria-label="Notifications"]').click();
  const row = page
    .locator('button')
    // The sentence shared-items step 2 builds from the facts: "<author> shared <artifact>".
    .filter({ hasText: ` shared ${entry.name}` })
    .first();
  const listed = await row
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  await screenshot(mate, `notification-list-${number}`);
  check(
    `${number}a  the share notification names the artifact ${why} (from ${author.email})`,
    listed,
    listed ? '' : `no row saying "<author> shared ${entry.name}"`
  );
  if (!listed) {
    // The dropdown's backdrop closes it.
    await page.locator('.fixed.inset-0.z-40').click({ position: { x: 10, y: 700 } });
    return;
  }
  await row.click();
  const frame = await findFrameWith(page, entry.marker);
  await screenshot(mate, `notification-open-${number}`);
  check(`${number}b  clicking it opens the shared artifact ${why}`, frame !== null);
}
