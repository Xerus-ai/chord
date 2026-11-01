import { waitFor } from './sharing-accounts.mjs';

const settles = (promise) =>
  promise.then(
    () => true,
    () => false
  );

const PENDING_REQUESTS = 6;

/**
 * Check 8h, after 8g left the owner's chat open in the teammate's view: a
 * teammate's dock lists every pending request of the chat
 * (cloud-approval-cards.tsx), so six of them must not squeeze the transcript.
 * The owner publishes them through the route its sync queue drives (PUT
 * permission-requests, creator-only); the dock holds them in a capped strip
 * that scrolls, and the transcript keeps at least half the thread.
 */
export async function runTeammateDockChecks({
  author,
  mate,
  workItemId,
  stamp,
  cleanup,
  results,
  shot,
}) {
  const { check } = results;
  const { page } = mate.instance;
  const itemPath = `/work-items/${workItemId}`;
  const sessions = (await author.api('GET', itemPath)).body?.sessions ?? [];
  const chat = sessions.find((s) => s.status !== 'done');
  if (!chat) throw new Error('the owner has no published chat to hold the requests');

  const toolPrefix = `e2e_dock_${stamp}`;
  const requestIds = Array.from({ length: PENDING_REQUESTS }, (_, i) => `${toolPrefix}_${i}`);
  for (const requestId of requestIds) {
    const put = await author.api('PUT', `${itemPath}/permission-requests/${requestId}`, {
      work_item_id: workItemId,
      session_id: chat.id,
      tool_name: requestId,
      input: { command: `echo ${requestId}` },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
      status: 'pending',
    });
    if (put.status !== 201 && put.status !== 200) {
      throw new Error(`publishing ${requestId} answered ${put.status}`);
    }
    cleanup.add(`expire the dock request ${requestId}`, () =>
      author.api('PUT', `${itemPath}/permission-requests/${requestId}`, {
        work_item_id: workItemId,
        status: 'expired',
        resolution: 'expired',
      })
    );
  }

  // One title per card: the tool name alone (its command also holds the name).
  const cards = page
    .locator('[data-testid="chat-dock"]')
    .getByText(new RegExp(`^${toolPrefix}_\\d+$`));
  const listed = await settles(
    waitFor(async () => (await cards.count()) === PENDING_REQUESTS, 30_000, 'the six cards')
  );
  const thread = page.locator('[data-testid="chat-thread"]').first();
  const dock = thread.locator('[data-testid="chat-dock"]');
  const transcript = thread.locator('[data-testid="chat-transcript"]');
  const [threadBox, transcriptBox] = await Promise.all([
    thread.boundingBox(),
    transcript.boundingBox(),
  ]);
  const sizes =
    threadBox && transcriptBox
      ? {
          thread: threadBox.height,
          transcript: transcriptBox.height,
          dockScrolls: await dock.evaluate((el) => el.scrollHeight > el.clientHeight),
        }
      : null;
  await shot(mate, 'teammate-dock');
  check(
    `8h  ${PENDING_REQUESTS} pending requests scroll in the dock; the transcript keeps half the thread`,
    listed && sizes !== null && sizes.dockScrolls && sizes.transcript >= sizes.thread / 2,
    `${await cards.count()} cards, ${JSON.stringify(sizes)}`
  );
}
