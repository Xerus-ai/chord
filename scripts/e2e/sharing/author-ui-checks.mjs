/**
 * The author's own app (design 2026-09-24 §9 "View document format"): saving
 * a version of a page that references something remote warns the author, in
 * the app's toast, that viewers will not get it — the same toast "Add to
 * artifacts" shows (renderer/features/artifacts/report-view-warnings.ts).
 */
import { REMOTE_SCRIPT } from './format-fixtures.mjs';
import { findFrameWith, followLink, screenshot } from './teammate-ui-helpers.mjs';

/**
 * Check 19: the web page (published with a remote script in
 * publishFormatsFromApp) is opened in the author's app through its link, a
 * version is saved from the toolbar, and the warning toast names the script.
 */
export async function runViewWarningToastCheck({ author, formats, results }) {
  const { check } = results;
  const { page } = author.instance;
  const web = formats.entries.find((entry) => entry.kind === 'web');
  await followLink(author, `chord://open/artifact/${web.artifactId}`);
  const frame = await findFrameWith(page, web.marker);
  if (!frame) throw new Error('the web page did not open as a tab in the author app');

  await page.locator('button[title="More actions"]').click();
  await page.getByText('Save version', { exact: true }).click();
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: "won't load for viewers" })
    .first();
  const shown = await toast
    .waitFor({ timeout: 20_000 })
    .then(() => toast.innerText())
    .catch(() => '');
  await screenshot(author, 'view-warning-toast');
  check(
    '19a  saving a version of a page with a remote reference warns the author',
    shown.includes("won't load for viewers"),
    shown ? shown.slice(0, 120) : 'no such toast'
  );
  check('19b  …naming the reference', shown.includes(REMOTE_SCRIPT));
}
