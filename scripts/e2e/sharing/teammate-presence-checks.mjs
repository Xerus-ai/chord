import { waitFor } from './sharing-accounts.mjs';
import { followLink } from './teammate-ui-helpers.mjs';

const settles = (promise) =>
  promise.then(
    () => true,
    () => false
  );

/** The presence `file` someone advertises on a work item, read as the author. */
async function presenceFileOf(author, workItemId, email) {
  const rows = (await author.api('GET', `/presence/${workItemId}`)).body ?? [];
  return rows.find((row) => row.email === email)?.cursor_position?.file ?? null;
}

/**
 * Checks 8j-8k (step 4 S3, decision 7), last in the suite because the split
 * stays: being in a chat tab counts as presence, so the owner in one rings in
 * the teammate's header; and a view sends one presence, its focused pane's
 * tab, so in a split the teammate's presence follows the pane they focus.
 */
export async function runTeammatePresenceChecks({
  author,
  mate,
  workItemId,
  artifactId,
  artifactName,
  results,
  shot,
}) {
  const { check } = results;
  const ownerPage = author.instance.page;
  const matePage = mate.instance.page;
  const sessions = (await author.api('GET', `/work-items/${workItemId}`)).body?.sessions ?? [];
  const chat = sessions.find((s) => s.status !== 'done');
  if (!chat) throw new Error('the owner has no published chat for the presence checks');

  // 8j: the owner in their chat tab rings for the teammate.
  await followLink(author, `chord://open/work-item/${workItemId}`);
  await ownerPage
    .locator('[aria-label^="End session "]')
    .first()
    .locator('xpath=ancestor::*[@title][1]')
    .click({ position: { x: 24, y: 12 }, timeout: 30_000 });
  await followLink(mate, `chord://open/work-item/${workItemId}`);
  const ownerFile = await settles(
    waitFor(
      async () => (await presenceFileOf(author, workItemId, author.email)) === `session:${chat.id}`,
      30_000,
      'the owner’s presence in their chat'
    )
  );
  // A teammate's stack is not the Share button, so it has no header-avatar-stack
  // test id (avatar-stack.tsx); the header holds one stack.
  const ring = matePage.locator('[data-testid="work-item-header"] [data-viewing="true"]');
  const ringed = await settles(ring.first().waitFor({ timeout: 30_000 }));
  await shot(mate, 'teammate-sees-owner-in-chat');
  check(
    '8j  the owner in a chat tab rings in the teammate’s header',
    ownerFile && ringed,
    `presence ${await presenceFileOf(author, workItemId, author.email)}, ring ${ringed}`
  );

  // 8k: split the teammate's chat into a pane of its own; presence is the
  // focused pane's tab. Stacked, not side by side: at the e2e window's width
  // the centre is too narrow for two side-by-side panes ("Pane too narrow").
  const chatTab = matePage
    .getByRole('tab')
    .filter({ has: matePage.locator('[aria-label^="Close tab "]') })
    .first();
  await chatTab.click({ button: 'right', position: { x: 24, y: 12 }, timeout: 30_000 });
  await matePage.getByRole('menuitem', { name: /^Split Down/ }).click({ timeout: 10_000 });
  const split = await settles(
    waitFor(async () => (await matePage.locator('[data-pane-id]').count()) === 2, 10_000, 'a split')
  );
  const onChat = await settles(
    waitFor(
      async () => (await presenceFileOf(author, workItemId, mate.email)) === `session:${chat.id}`,
      20_000,
      'the teammate’s presence on the chat pane'
    )
  );
  await matePage
    .getByRole('tab')
    .filter({ hasText: artifactName })
    .first()
    .click({ position: { x: 24, y: 12 }, timeout: 30_000 });
  const onArtifact = await settles(
    waitFor(
      async () =>
        (await presenceFileOf(author, workItemId, mate.email)) === `artifact:${artifactId}`,
      20_000,
      'the teammate’s presence on the artifact pane'
    )
  );
  await shot(mate, 'teammate-split-presence');
  check(
    '8k  in a split, the teammate’s presence is the focused pane’s tab only',
    split && onChat && onArtifact,
    `split ${split}, chat pane ${onChat}, artifact pane ${onArtifact}`
  );
}
