/* global document -- page.evaluate callbacks run inside the app window */
/**
 * Driving Confluence publishing in the app for artifact-confluence.mjs, on
 * the shared-items step 3 surfaces: the Share dialog's Publish tab
 * (`[data-testid="publish-confluence"]`, its `data-state` from
 * `describeConfluencePublish`) and the file bar's Confluence chip.
 */

/** @param {import('playwright').Page} page @param {ReturnType<typeof import('./confluence-rest.mjs').createConfluenceRest>} rest */
export function createConfluencePublishUi(page, rest) {
  const bodyText = () => page.evaluate(() => document.body.innerText);
  async function clickButton(text) {
    await page.evaluate((label) => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === label && b.offsetParent !== null
      );
      if (!button) throw new Error(`Button not found: ${label}`);
      button.click();
    }, text);
  }
  async function waitFor(predicate, timeout, what) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await page.waitForTimeout(500);
    }
    console.log(`  (timed out waiting for ${what})`);
    return false;
  }
  /** The Publish tab's Confluence state (`describeConfluencePublish`), or null when it is closed. */
  const readState = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-testid="publish-confluence"]')?.getAttribute('data-state') ??
        null
    );
  /** The file bar's Confluence chip title, or null before the first publish. */
  const readChip = () =>
    page.evaluate(
      () => document.querySelector('[data-testid="confluence-chip"]')?.getAttribute('title') ?? null
    );
  async function findOnePage(title) {
    const pages = await rest.findPagesByTitle(title);
    return pages.length === 1 ? pages[0] : null;
  }

  async function openArtifact(name) {
    await page.evaluate((artifactName) => {
      const row = [...document.querySelectorAll('button')].find((b) =>
        b.textContent.trim().startsWith(artifactName)
      );
      if (!row) throw new Error(`Artifact row not found: ${artifactName}`);
      row.click();
    }, name);
    await waitFor(
      async () => (await page.locator('[data-testid="file-bar"]').count()) > 0,
      60_000,
      `${name} file bar`
    );
    // Let the editor settle its first render before anything compares content.
    await page.waitForTimeout(2500);
  }

  /**
   * The Share dialog on its Publish tab for the artifact in focus: through the
   * file bar's chip once it is published, else the header's Share.
   */
  async function openPublish() {
    const dialog = page.locator('[data-testid="share-dialog"]');
    if (await readChip()) {
      await page.locator('[data-testid="confluence-chip"]').click();
    } else {
      await page.getByRole('button', { name: 'Share', exact: true }).first().click();
      await dialog.waitFor({ timeout: 30_000 });
      await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    }
    await page.locator('[data-testid="publish-confluence"]').waitFor({ timeout: 30_000 });
  }

  async function closePublish() {
    await page.keyboard.press('Escape');
    await page
      .locator('[data-testid="share-dialog"]')
      .waitFor({ state: 'hidden', timeout: 10_000 });
  }

  async function publishAndFind(name, timeout = 120_000) {
    await openPublish();
    await waitFor(async () => (await readState()) === 'unpublished', 30_000, `${name} unpublished`);
    await clickButton('Publish to Confluence');
    await waitFor(async () => (await readState()) === 'published', timeout, `${name} published`);
    await closePublish();
    return findOnePage(name);
  }

  return {
    bodyText,
    clickButton,
    waitFor,
    readState,
    readChip,
    findOnePage,
    openArtifact,
    openPublish,
    closePublish,
    publishAndFind,
  };
}
