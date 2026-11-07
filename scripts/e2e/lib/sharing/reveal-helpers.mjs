/* global document -- page.evaluate callbacks run in the renderer */
/**
 * Fixtures and probes for the step 5 done-check (shared-items-reveal.mjs): a
 * throw-away work item of the owner's with chats of its own, history pushed
 * the way the owner's app pushes it, and where a revealed row sits on screen.
 */
import { randomUUID } from 'node:crypto';
import { createScratchRepo, removeScratchRepo } from '../run-scratch.mjs';
import { waitFor } from './sharing-accounts.mjs';
import { expectStatus } from './sharing-fixtures.mjs';

/**
 * A work item created in the owner's app on a throw-away repo, synced to the
 * cloud and shared with the teammate (Can edit), with two chats the suite
 * owns: ending one never touches a chat of the seed's. Shared before the chats
 * start, since the owner's app publishes chats only for a shared item (it
 * learns of the share on its shared-set refresh, every 60 s). Removed (app
 * and cloud) by cleanup.
 */
export async function createRevealWorkItem({ author, mate, stamp, cleanup }) {
  const repo = createScratchRepo('reveal', { 'README.md': `# Reveal ${stamp}\n` });
  cleanup.add('remove the reveal repo', () => removeScratchRepo(repo));
  const name = `Step 5 reveal ${stamp}`;
  const { item } = await author.call('workItems.create', { name, repoPath: repo });
  const workItemId = item.id;
  cleanup.add('delete the reveal work item in the cloud', () =>
    author.api('DELETE', `/work-items/${workItemId}`)
  );
  cleanup.add('remove the reveal work item from the app', () =>
    author.call('workItems.remove', workItemId)
  );
  await waitFor(
    async () => {
      const { items } = await author.call('workItems.getAll');
      return items.find((w) => w.id === workItemId)?.provisionStatus === 'ready';
    },
    60_000,
    'the reveal work item provisioned'
  );
  await waitFor(
    async () => (await author.api('GET', `/work-items/${workItemId}`)).status === 200,
    60_000,
    'the reveal work item synced to the cloud'
  );
  expectStatus(
    await author.api('POST', `/work-items/${workItemId}/members`, {
      email: mate.email,
      role: 'edit',
    }),
    [200, 201],
    'share the item, Can edit'
  );

  const chats = {};
  for (const label of ['A', 'B']) {
    const { session } = await author.call('agentSessions.create', {
      workItemId,
      kind: 'chat',
      agentProviderId: 'claude',
      title: `Reveal ${label} ${stamp}`,
    });
    chats[label] = session;
    // B is created second, so it is the more recently active chat.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  await waitFor(
    async () => {
      const published = (await author.api('GET', `/work-items/${workItemId}`)).body?.sessions ?? [];
      return ['A', 'B'].every((l) => published.some((s) => s.id === chats[l].id));
    },
    150_000,
    'both chats published'
  );
  return { workItemId, name, chats };
}

/**
 * History the way the owner's app pushes it (PUT /messages/bulk): `count`
 * human rows a minute apart, ending an hour ago, in one chat. Returns the
 * rows, oldest first.
 */
export async function pushHistory(author, workItemId, { sessionId, count, label }) {
  const end = Date.now() - 60 * 60 * 1000;
  const rows = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    session_id: sessionId,
    sender_type: 'human',
    sender_name: author.email,
    content: `${label} history row ${i + 1} of ${count}`,
    message_type: 'text',
    metadata: {},
    created_at: new Date(end - (count - 1 - i) * 60_000).toISOString(),
  }));
  expectStatus(
    await author.api('PUT', `/work-items/${workItemId}/messages/bulk`, { messages: rows }),
    200,
    `push ${count} ${label} rows`
  );
  return rows;
}

/** One row pushed now (a null session is work-item history, in every chat). */
export async function pushOne(author, workItemId, { sessionId, content }) {
  const row = {
    id: randomUUID(),
    session_id: sessionId,
    sender_type: 'human',
    sender_name: author.email,
    content,
    message_type: 'text',
    metadata: {},
    created_at: new Date().toISOString(),
  };
  expectStatus(
    await author.api('PUT', `/work-items/${workItemId}/messages/bulk`, { messages: [row] }),
    200,
    `push "${content}"`
  );
  return row;
}

export async function mention(account, workItemId, { userId, excerpt, messageId }) {
  expectStatus(
    await account.api('POST', `/work-items/${workItemId}/mentions`, {
      user_ids: [userId],
      excerpt,
      message_id: messageId,
    }),
    201,
    `mention "${excerpt}"`
  );
}

/** The session tab whose label is `label`. */
export function chatTab(page, label) {
  return page.locator('[role="tab"]').filter({ hasText: label }).first();
}

/** Closes a tab the way a person does: its × shows on hover. */
export async function closeChatTab(page, label, closeLabel) {
  await chatTab(page, label).hover();
  await page.locator(`[aria-label="${closeLabel} ${label}"]`).first().click({ timeout: 10_000 });
}

/**
 * Where a row sits in its transcript: whether it is rendered, inside the
 * transcript's visible box, highlighted, and how far the transcript is from
 * its bottom.
 */
export async function readRevealState(page, messageId) {
  return page.evaluate((id) => {
    const row = document.querySelector(`[data-entry-id="${id}"]`);
    if (!row) return { rendered: false };
    const transcript = row.closest('[data-testid="chat-transcript"]');
    const box = row.getBoundingClientRect();
    const view = transcript.getBoundingClientRect();
    return {
      rendered: true,
      inView: box.bottom > view.top && box.top < view.bottom && box.height > 0,
      revealed: row.getAttribute('data-revealed') === 'true',
      fromBottom: Math.round(
        transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight
      ),
    };
  }, messageId);
}

/** Waits for the row to be revealed: rendered, in view and highlighted. */
export async function waitForReveal(page, messageId, timeoutMs = 45_000) {
  let state = { rendered: false };
  await waitFor(
    async () => {
      state = await readRevealState(page, messageId);
      return state.rendered && state.inView && state.revealed;
    },
    timeoutMs,
    `message ${messageId} revealed`
  ).catch(() => {});
  return state;
}
