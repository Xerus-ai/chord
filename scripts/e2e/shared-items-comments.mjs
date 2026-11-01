/* global document, window, NodeFilter -- page.evaluate callbacks run inside the app window */
/**
 * Shared-items step 1, S6 done-check (part C of shared-items-tab.mjs): the
 * comments card, page pins and click-to-comment, the card's filter and
 * numbers, "Element changed", and document badges. Runs on the throw-away
 * work item part B creates; the fixtures below are committed into its repo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const COMMENT_FIXTURES = {
  'probe.html': `<!doctype html>
<html>
<head><title>pins probe</title></head>
<body>
  <h1 id="h">Pins probe</h1>
  <p id="p">First paragraph</p>
  <p id="q">Second paragraph</p>
</body>
</html>
`,
  'notes.md': '# Notes\n\nTeam costs $24 a seat.\n\nPro costs more.\n',
};

const settles = (promise) => promise.then(() => true).catch(() => false);

export async function checkComments({ s, check, shot, bar, openFromFiles, workItemId, root }) {
  const { page } = s;
  for (const name of Object.keys(COMMENT_FIXTURES)) {
    const res = await s.rpc('artifacts.create', { workItemId, filePath: join(root, name), name });
    check(`${name} is published as an artifact`, res.success, JSON.stringify(res.error ?? ''));
  }
  const pagePath = join(root, 'probe.html');
  const card = page.locator('[data-testid="comments-card"]');
  const toggleComments = () => bar().locator('button[title="Comments"]').click();

  // Page: double-click edits, the card's click-to-comment, pins. The file was
  // published with its work item open, so it may open as a repo file until
  // the artifact list arrives and the tab becomes the artifact's; the frame
  // is re-resolved on every use rather than held across that swap.
  await openFromFiles('probe.html');
  await bar().locator('button[title="Comments"]').waitFor({ timeout: 30_000 });
  const frame = page.frameLocator('iframe[src^="chord-artifact://"]').first();
  const inFrame = (selector) => frame.locator(selector).first();
  // Edit text is on once the frame has marked its editable elements.
  await inFrame('#h[data-chord-editable]').waitFor({ timeout: 60_000 });
  const barText = (await bar().innerText()).replace(/\s+/g, ' ');
  check(
    'the page bar has no Select or Edit text button',
    !/\bSelect\b|Edit text/.test(barText),
    barText
  );

  await inFrame('#h').dblclick();
  const editable = await settles(
    inFrame('#h[contenteditable="plaintext-only"]').waitFor({ timeout: 10_000 })
  );
  if (editable) {
    await inFrame('#h').fill('Pins probe edited');
    await inFrame('#h').press('Enter');
  }
  let onDisk = '';
  for (let i = 0; i < 60 && !onDisk.includes('Pins probe edited'); i++) {
    await page.waitForTimeout(250);
    onDisk = readFileSync(pagePath, 'utf-8');
  }
  check(
    "a double-click edits an owner's page text in place",
    editable && onDisk.includes('Pins probe edited'),
    `editable=${editable}`
  );

  await toggleComments();
  await settles(card.waitFor({ timeout: 10_000 }));
  check(
    '💬 opens the comments card with its empty state',
    ((await card.innerText().catch(() => '')) ?? '').includes(
      'Click anywhere on the page to add one.'
    )
  );

  const commentOn = async (selector, body) => {
    await inFrame(selector).click();
    const popover = page.locator('[data-testid="ask-agent-card"]');
    await popover.waitFor({ timeout: 10_000 });
    const offersAsk = (await popover.getByRole('button', { name: 'Ask agent' }).count()) === 1;
    await popover.locator('textarea').fill(body);
    await popover.getByRole('button', { name: 'Comment', exact: true }).click();
    await settles(popover.waitFor({ state: 'detached', timeout: 10_000 }));
    return offersAsk;
  };
  const thread = (n) => card.locator(`[data-comment-thread="${n}"]`);
  const pinDrawn = (n, extra = '') =>
    settles(inFrame(`[data-chord-pin="${n}"]${extra}`).waitFor({ timeout: 10_000 }));

  const offersAsk = await commentOn('#p', 'S6 first comment');
  check('a click on the page opens Comment, with Ask agent for the owner', offersAsk);
  check(
    'the comment is thread 1, with pin 1 on the page',
    (await settles(thread(1).waitFor({ timeout: 10_000 }))) && (await pinDrawn(1))
  );
  await commentOn('#q', 'S6 second comment');
  check(
    'the next comment is thread 2, with pin 2',
    (await settles(thread(2).waitFor({ timeout: 10_000 }))) && (await pinDrawn(2))
  );
  await shot('comments-pins');

  await toggleComments();
  await settles(card.waitFor({ state: 'detached', timeout: 5_000 }));
  const pinWhileClosed = await pinDrawn(1);
  await inFrame('[data-chord-pin="1"]').click();
  const openedOnThread = await settles(
    thread(1).getByText('Reply', { exact: true }).waitFor({ timeout: 10_000 })
  );
  check(
    'pins stay with the card closed; clicking one opens the card on its thread',
    pinWhileClosed && openedOnThread
  );

  await thread(2).click();
  check('selecting thread 2 in the card marks pin 2', await pinDrawn(2, '[data-selected]'));

  await thread(2).getByText('Resolve', { exact: true }).click();
  await page.waitForTimeout(1000);
  const rows = () =>
    card
      .locator('[data-comment-thread]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-comment-thread')));
  const openRows = await rows();
  await card.getByRole('button', { name: /^Resolved/ }).click();
  await page.waitForTimeout(500);
  const resolvedRows = await rows();
  const resolvedPins = await frame
    .locator('[data-chord-pin]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-chord-pin')));
  check(
    'a resolved thread keeps its number: Open lists 1; Resolved lists and pins 2',
    JSON.stringify(openRows) === '["1"]' &&
      JSON.stringify(resolvedRows) === '["2"]' &&
      JSON.stringify(resolvedPins) === '["2"]',
    `open=${openRows} resolved=${resolvedRows} pins=${resolvedPins}`
  );
  await card.getByRole('button', { name: /^Open/ }).click();

  writeFileSync(
    pagePath,
    readFileSync(pagePath, 'utf-8').replace('First paragraph', 'Rewritten paragraph')
  );
  check(
    'rewriting a commented element on disk shows "Element changed"',
    await settles(thread(1).getByText('Element changed').waitFor({ timeout: 20_000 }))
  );
  await shot('comments-element-changed');

  // Document: a text-selection comment's badge, following its text.
  await openFromFiles('notes.md');
  const editor = page.locator('.artifact-editor-content').first();
  await page.waitForFunction(
    () => document.querySelector('.artifact-editor-content')?.textContent.includes('$24'),
    null,
    { timeout: 30_000 }
  );
  await editor.click({ position: { x: 4, y: 4 } });
  await page.evaluate(() => {
    const root = document.querySelector('.artifact-editor-content');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf('$24');
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 3);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      return;
    }
    throw new Error('$24 is not in the document');
  });
  await page.locator('button[title="Comment"]').first().click({ timeout: 10_000 });
  const composer = page.locator('textarea[placeholder^="Add a comment…"]').first();
  await composer.fill('S6 document comment');
  await composer.press('Enter');
  const badge = page.locator('.artifact-editor-content .chord-comment-badge').first();
  const anchor = page.locator('.artifact-editor-content .chord-comment-anchor').first();
  const badgeShown = await settles(badge.waitFor({ timeout: 10_000 }));
  const quoted = await anchor.textContent().catch(() => null);
  check(
    'a document comment shows its number at the quoted text',
    badgeShown && (await badge.textContent()) === '1' && quoted === '$24',
    `quoted=${quoted}`
  );

  await editor.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Intro line. ');
  await page.waitForTimeout(500);
  const quotedAfter = await anchor.textContent().catch(() => null);
  check(
    'the badge follows its text when the document is edited above it',
    quotedAfter === '$24' && (await badge.textContent()) === '1',
    `quoted=${quotedAfter}`
  );

  await badge.click();
  check(
    'clicking a badge selects its thread in the card',
    await settles(thread(1).getByText('Reply', { exact: true }).waitFor({ timeout: 10_000 }))
  );
  await shot('comments-document');
}
