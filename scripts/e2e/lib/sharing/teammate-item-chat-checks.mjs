import { waitFor } from './sharing-accounts.mjs';
import { createCloudWorkItem, expectStatus } from './sharing-fixtures.mjs';
import { followLink } from './teammate-ui-helpers.mjs';

const settles = (promise) =>
  promise.then(
    () => true,
    () => false
  );

/**
 * Checks 9d-9e (step 4 decisions 5 and 7): a work item whose owner has
 * published no chat. The teammate's whole chat is the Work item chat tab,
 * focused, with the item's thread; being in it counts as presence, so their
 * row on the item names the chat.
 */
export async function runTeammateItemChatChecks({
  author,
  mate,
  orgId,
  stamp,
  cleanup,
  results,
  shot,
}) {
  const { check } = results;
  const { page } = mate.instance;
  const workItemId = await createCloudWorkItem(author, {
    orgId,
    name: `Step 4 e2e ${stamp} — no chats`,
    generalAccess: 'invited',
    generalRole: 'view',
  });
  cleanup.add('delete the no-chats work item', () =>
    author.api('DELETE', `/work-items/${workItemId}`)
  );
  const itemPath = `/work-items/${workItemId}`;
  expectStatus(
    await author.api('POST', `${itemPath}/members`, { email: mate.email, role: 'view' }),
    [200, 201],
    'share the no-chats item'
  );

  await followLink(mate, `chord://open/work-item/${workItemId}`);
  const tab = page.locator('[role="tab"][title="The work item\'s chat"]').first();
  const shown = await settles(tab.waitFor({ timeout: 45_000 }));
  const selected = shown && (await tab.getAttribute('aria-selected')) === 'true';
  const threads = await page.locator('[data-testid="chat-thread"]').count();
  await shot(mate, 'teammate-item-chat');
  check(
    '9d  no chat published: the teammate is in the Work item chat tab, focused',
    shown && selected && threads > 0,
    `tab ${shown}, selected ${selected}, ${threads} chat threads`
  );

  let row = null;
  const present = await settles(
    waitFor(
      async () => {
        const rows = (await author.api('GET', `/presence/${workItemId}`)).body ?? [];
        row = rows.find((r) => r.email === mate.email) ?? null;
        return row?.cursor_position?.file === 'session:work-item-chat';
      },
      30_000,
      'the teammate’s presence in the item chat'
    )
  );
  check(
    '9e  …and being in it counts: their presence names the chat',
    present,
    JSON.stringify(row && { cursor_position: row.cursor_position, active_view: row.active_view })
  );
}
