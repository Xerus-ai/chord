/**
 * The teammate's work item after shared-items step 4: the owner's components
 * (test ids work-item-header, chat-thread, rail-activity-bar, path-tab-body),
 * scoped to the shared artifacts for an artifacts-only viewer (S9), and the
 * owner's chats as session tabs for a work-item member (S5b).
 */
import { waitFor } from './sharing-accounts.mjs';
import { ensureRailOpen } from './teammate-ui-helpers.mjs';

const settles = (promise) =>
  promise.then(
    () => true,
    () => false
  );

/** The rail's tab labels, without their counts ("Changes 3" → "Changes"). */
async function railTabLabels(page) {
  const texts = await page
    .locator('[data-testid="rail-activity-bar"] [role="tab"]')
    .allInnerTexts();
  return texts.map((text) => text.replace(/\s*\d+\s*$/, '').trim());
}

/**
 * After the sidebar row of an artifact-only share was clicked (check 5d):
 * the work item, scoped — its header, no chat, only the Work item panel,
 * which says what the viewer can see, and the artifact in its tab.
 */
export async function runScopedViewChecks({ mate, ownerName, results, shot }) {
  const { check } = results;
  const { page } = mate.instance;
  const header = page.locator('[data-testid="work-item-header"]');
  const shown = await settles(header.waitFor({ timeout: 30_000 }));
  const headerText = shown ? await header.innerText() : '';
  check(
    '5e  the artifact-only share opens its work item, scoped: the header names the owner',
    shown && headerText.includes(`Shared by ${ownerName}`),
    JSON.stringify(headerText)
  );
  const chats = await page.locator('[data-testid="chat-thread"]').count();
  check('5f  …with no chat', chats === 0, `${chats} chat threads`);
  await ensureRailOpen(page);
  const tabs = await railTabLabels(page);
  check(
    '5g  …and only the Work item panel in the rail (no Changes, no Files)',
    JSON.stringify(tabs) === JSON.stringify(['Work item']),
    JSON.stringify(tabs)
  );
  const notice = await settles(
    page.getByText('You can see 1 artifact in this work item.').first().waitFor({ timeout: 15_000 })
  );
  check('5h  …which says what the viewer can see, and who shared it', notice);
  const body = await page.locator('[data-testid="path-tab-body"]').count();
  await shot(mate, 'scoped-view');
  check('5i  …with the artifact in its tab', body > 0, `${body} path tab bodies`);
}

/**
 * After the teammate opened the work item as a member (check 8): the owner's
 * header, rail without Files, the artifact in its tab, and the owner's chat as
 * a tab that the teammate can close and reopen from the strip's `+`; a closed
 * tab stays closed when the registry refetches.
 */
export async function runTeammateViewChecks({
  author,
  mate,
  artifactId,
  ownerName,
  results,
  shot,
}) {
  const { check } = results;
  const { page } = mate.instance;
  const header = page.locator('[data-testid="work-item-header"]');
  const headerText = (await settles(header.waitFor({ timeout: 30_000 })))
    ? await header.innerText()
    : '';
  check(
    '8b  the teammate sees the owner’s header, naming who shared it',
    headerText.includes(`Shared by ${ownerName}`),
    JSON.stringify(headerText)
  );
  await ensureRailOpen(page);
  const tabs = await railTabLabels(page);
  check(
    '8c  …the rail without a Files tab',
    JSON.stringify(tabs) === JSON.stringify(['Work item', 'Changes', 'Checks']),
    JSON.stringify(tabs)
  );
  const body = await page.locator('[data-testid="path-tab-body"]').count();
  check('8d  …the artifact in the owner’s path tab', body > 0, `${body} path tab bodies`);

  // 8l (devstation-664): the status the owner sets reaches the teammate's file
  // bar, without a reload: the owner's app re-registers the artifact with it,
  // and the register's broadcast refetches the teammate's artifact list.
  await author.call('artifacts.updateStatus', { id: artifactId, status: 'in_review' });
  const badge = page.locator('[data-testid="path-tab-body"] [data-testid="artifact-status"]');
  const shown = await settles(
    waitFor(
      async () => (await badge.count()) > 0 && (await badge.first().innerText()) === 'In review',
      45_000,
      'the owner’s status on the teammate’s file bar'
    )
  );
  await shot(mate, 'teammate-artifact-status');
  check(
    '8l  …and its status as the owner sets it, live',
    shown,
    (await badge.count()) > 0 ? await badge.first().innerText() : 'no badge'
  );

  // A session tab's close button shows only while the tab is hovered
  // (chrome-tabs.tsx), so the tab is found by the button it holds, and hovered
  // before the close is clicked, as a user does.
  const closeTabButton = '[aria-label^="Close tab "]';
  const chatTab = page
    .getByRole('tab')
    .filter({ has: page.locator(closeTabButton) })
    .first();
  const hasChatTab = await settles(chatTab.waitFor({ timeout: 45_000 }));
  const chatThreads = await page.locator('[data-testid="chat-thread"]').count();
  await shot(mate, 'teammate-chat-tab');
  check(
    '8e  …the owner’s chat as a session tab, in the owner’s transcript',
    hasChatTab && chatThreads > 0,
    `tab ${hasChatTab}, ${chatThreads} chat threads`
  );
  if (!hasChatTab) return;

  const closeButton = chatTab.locator(closeTabButton);
  const label = (await closeButton.getAttribute('aria-label')).replace(/^Close tab /, '');
  await chatTab.hover();
  await closeButton.click();
  const closed = page.locator(`[aria-label="Close tab ${label}"]`);
  await waitFor(async () => (await closed.count()) === 0, 10_000, 'the chat tab to close');
  // The registry refetches on every agent turn and work item update; give it time.
  await page.waitForTimeout(8000);
  check(
    '8f  a chat tab the teammate closed stays closed',
    (await closed.count()) === 0,
    `${await closed.count()} tabs`
  );

  await page.getByRole('button', { name: 'Open a chat' }).first().click();
  const entry = page.getByRole('menuitem').filter({ hasText: label }).first();
  const offered = await settles(entry.waitFor({ timeout: 10_000 }));
  if (offered) await entry.click();
  const reopened = await settles(closed.first().waitFor({ state: 'attached', timeout: 10_000 }));
  await shot(mate, 'teammate-chat-reopened');
  check('8g  …and the strip’s + reopens it', offered && reopened, `offered ${offered}`);
}
