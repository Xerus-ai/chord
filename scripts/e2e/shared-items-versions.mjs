/* global document -- page.evaluate callbacks run inside the app window */
/**
 * Shared-items step 1, S7 done-check (part D of shared-items-tab.mjs): the
 * Versions card, and Restore for a page and a document. Runs on the
 * throw-away work item after part C, whose page (probe.html) and document
 * (notes.md) already have history.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const settles = (promise) => promise.then(() => true).catch(() => false);

export async function checkVersions({ s, check, shot, bar, openFromFiles, workItemId, root }) {
  const { page } = s;
  const card = page.locator('[data-testid="versions-card"]');
  const row = (n) => card.locator(`[data-version="${n}"]`);
  const artifactId = async (name) => {
    const list = await s.rpc('artifacts.listByWorkItem', workItemId);
    return list.data.artifacts.find((a) => a.name === name).id;
  };
  const versionsOf = async (name) => {
    const result = await s.rpc('artifacts.listVersions', { artifactId: await artifactId(name) });
    return result.data.versions;
  };
  const restore = async () => {
    await page.locator('[data-testid="viewing-version"]').getByText('Restore').click();
  };

  // Page: v1 is the publish, v2 the in-place edit from part C.
  const pagePath = join(root, 'probe.html');
  const pageBefore = await versionsOf('probe.html');
  const v1 = pageBefore.find((v) => v.versionNumber === 1);
  const latest = pageBefore[0].versionNumber;
  await openFromFiles('probe.html');
  await bar().locator('button[title="Versions"]').click();
  await settles(card.waitFor({ timeout: 10_000 }));
  const listed = await card
    .locator('[data-version]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-version')));
  check(
    '🕘 opens the Versions card, newest first',
    JSON.stringify(listed) === JSON.stringify(pageBefore.map((v) => String(v.versionNumber))),
    `listed=${listed}`
  );

  await row(1).click();
  const viewing = page.locator('[data-testid="viewing-version"]');
  check(
    'picking v1 shows it, with Restore on the bar',
    (await settles(viewing.getByText('Viewing v1').waitFor({ timeout: 10_000 }))) &&
      (await viewing.getByText('Restore').count()) === 1
  );
  // v1 is the page as published, before part C edited its heading in place.
  const previewHeading = page
    .frameLocator('iframe[src^="chord-artifact://"]')
    .first()
    .locator('#h');
  const shownHeading = await previewHeading
    .textContent({ timeout: 20_000 })
    .catch((e) => `ERR ${e.message.slice(0, 80)}`);
  check(
    'the v1 preview renders v1 in place, with no second banner',
    shownHeading?.trim() === 'Pins probe' &&
      (await page.getByText('Exit preview', { exact: true }).count()) === 0,
    `heading=${shownHeading}`
  );
  await shot('versions-viewing');
  await restore();
  const restoredRow = row(latest + 1);
  const restored = await settles(restoredRow.getByText('Restored v1').waitFor({ timeout: 20_000 }));
  let onDisk = '';
  for (let i = 0; i < 40 && onDisk !== v1.content; i++) {
    onDisk = readFileSync(pagePath, 'utf-8');
    if (onDisk !== v1.content) await page.waitForTimeout(250);
  }
  const pageAfter = await versionsOf('probe.html');
  check(
    'Restore on a page saves one new version "Restored v1" and puts the file back',
    restored &&
      onDisk === v1.content &&
      pageAfter.length === pageBefore.length + 1 &&
      pageAfter[0].label === 'Restored v1' &&
      pageAfter[0].trigger === 'manual',
    `versions=${pageAfter.map((v) => `${v.versionNumber}:${v.label ?? v.trigger}`)}`
  );
  check('the bar is back on the latest', (await viewing.count()) === 0);
  await shot('versions-restored-page');

  // Document: part C typed "Intro line." into it; save that, then restore v1.
  await openFromFiles('notes.md');
  await page.waitForFunction(
    () => document.querySelector('.artifact-editor-content')?.textContent.includes('Intro line.'),
    null,
    { timeout: 30_000 }
  );
  await bar().locator('button[title="More actions"]').click();
  await page.getByText('Save version', { exact: true }).click();
  await settles(card.waitFor({ timeout: 10_000 }));
  const docBefore = await versionsOf('notes.md');
  await row(1).click();
  await settles(viewing.getByText('Viewing v1').waitFor({ timeout: 10_000 }));
  await restore();
  const docRestored = await settles(
    row(docBefore[0].versionNumber + 1)
      .getByText('Restored v1')
      .waitFor({ timeout: 30_000 })
  );
  const text = await page.locator('.artifact-editor-content').first().textContent();
  const docAfter = await versionsOf('notes.md');
  check(
    'Restore on a document puts v1 back in the editor and saves it as "Restored v1"',
    docRestored &&
      !text.includes('Intro line.') &&
      text.includes('Team costs') &&
      docAfter.length === docBefore.length + 1 &&
      docAfter[0].label === 'Restored v1',
    `versions=${docAfter.map((v) => `${v.versionNumber}:${v.label ?? v.trigger}`)} text=${text.slice(0, 60)}`
  );
  await shot('versions-restored-document');
}
