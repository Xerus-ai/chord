/**
 * Shared-items step 1, S8 done-check (part E of shared-items-tab.mjs): the
 * rail's ARTIFACTS rows show `💬 N  vN` instead of a status word, a comment
 * raises N, and clicking 💬 or vN opens the artifact's tab with that card
 * open. Runs on the throw-away work item after parts C and D, whose page
 * (probe.html) already has comments and versions. The unread dot needs a
 * second account: shared-items-rail-unread.mjs.
 */

const settles = (promise) => promise.then(() => true).catch(() => false);

export async function checkRail({ s, check, shot, bar, openFromFiles, workItemId }) {
  const { page } = s;
  const list = await s.rpc('artifacts.listByWorkItem', workItemId);
  const probe = list.data.artifacts.find((a) => a.name === 'probe.html');
  const counts = page.locator(
    `[data-testid="artifact-rail-counts"][data-artifact-id="${probe.id}"]`
  );
  const commentsButton = counts.locator('button[title="Open comments"]');
  const versionsButton = counts.locator('button[title="Open versions"]');
  const commentsCard = page.locator('[data-testid="comments-card"]');
  const versionsCard = page.locator('[data-testid="versions-card"]');
  const railCount = async () => Number((await commentsButton.innerText()).replace(/\D/g, '') || 0);
  // ARTIFACTS lives on the rail's Work item panel; opening from Files leaves
  // the rail on Files, where the rows are mounted but hidden.
  const showWorkItemPanel = async () => {
    await page
      .getByRole('tab', { name: /^Work item/ })
      .first()
      .click();
    await page.waitForTimeout(500);
  };

  const { versions } = (await s.rpc('artifacts.listVersions', { artifactId: probe.id })).data;
  await showWorkItemPanel();
  const shown = await settles(counts.waitFor({ timeout: 20_000 }));
  const versionText = shown ? (await versionsButton.innerText()).trim() : '';
  check(
    'an ARTIFACTS row shows vN for the latest version',
    versionText === `v${versions[0].versionNumber}`,
    `shown=${shown} rail=${versionText} latest=v${versions[0].versionNumber}`
  );

  // The rail and the tab's own bar count the same open threads.
  await openFromFiles('probe.html');
  await bar().locator('button[title="Comments"]').waitFor({ timeout: 30_000 });
  const barCount = Number(
    (await bar().locator('button[title="Comments"]').innerText()).replace(/\D/g, '') || 0
  );
  await showWorkItemPanel();
  let before = -1;
  for (let i = 0; i < 40 && before !== barCount; i++) {
    before = await railCount();
    if (before !== barCount) await page.waitForTimeout(500);
  }
  check(
    'the rail’s 💬 N matches the open threads on the tab’s bar',
    before === barCount && barCount > 0,
    `rail=${before} bar=${barCount}`
  );
  await shot('rail-counts');

  // 💬 from another tab opens probe.html with its comments card open.
  await openFromFiles('notes.md');
  await showWorkItemPanel();
  await commentsButton.click();
  const cardOpened = await settles(commentsCard.waitFor({ timeout: 10_000 }));
  check(
    'clicking 💬 on the rail opens the artifact with its comments card',
    cardOpened && (await bar().innerText()).includes('probe.html'),
    (await bar().innerText()).replace(/\s+/g, ' ')
  );

  const composer = commentsCard.locator('textarea').first();
  await composer.fill('S8 rail comment');
  await composer.press('Enter');
  let after = before;
  for (let i = 0; i < 40 && after !== before + 1; i++) {
    await page.waitForTimeout(500);
    after = await railCount();
  }
  check(
    'a new comment raises the rail’s count',
    after === before + 1,
    `before=${before} after=${after}`
  );
  check(
    'your own comment never shows the unread dot',
    (await counts.getAttribute('data-unread')) === 'false'
  );

  // vN from another tab opens probe.html with its Versions card open.
  await openFromFiles('notes.md');
  await showWorkItemPanel();
  await versionsButton.click();
  const versionsOpened = await settles(versionsCard.waitFor({ timeout: 10_000 }));
  check(
    'clicking vN on the rail opens the artifact with its Versions card',
    versionsOpened && (await bar().innerText()).includes('probe.html'),
    (await bar().innerText()).replace(/\s+/g, ' ')
  );
  await shot('rail-versions-card');
}
