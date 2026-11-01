import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import {
  apiFetch,
  assert,
  connectWs,
  printSummaryAndExit,
  requireTokens,
  test,
  waitForMessage,
  waitForMessageWhere,
} from './e2e-harness.js';

/**
 * Live protocol probe for the participant chat pipeline (plan Phase B):
 * client message ids + sender acks, conflict semantics, keyset pagination,
 * and the creator-only bulk history push. Run with two real user JWTs:
 *   USER_A_TOKEN=... USER_B_TOKEN=... npx tsx src/e2e-chat-probe.ts
 */

const { userAToken, userBToken } = requireTokens();

interface ChatRow {
  id: string;
  content: string;
  created_at: string;
}

function cursorOf(row: ChatRow): string {
  return `${new Date(row.created_at).toISOString()},${row.id}`;
}

async function run(): Promise<void> {
  console.log('\n=== Chord Chat Protocol Probe (Phase B) ===\n');

  let orgId = '';
  let userBEmail = '';
  let workItemId = '';

  await test('Both users authenticate', async () => {
    const resA = await apiFetch('/me', userAToken);
    assert(resA.ok, `A auth failed: ${resA.status}`);
    const meA = (await resA.json()) as { orgId: string | null };
    const resB = await apiFetch('/me', userBToken);
    assert(resB.ok, `B auth failed: ${resB.status}`);
    const meB = (await resB.json()) as { userId: string; email: string };
    userBEmail = meB.email;
    // The JWT org claim can be null; A's existing rows carry the real org.
    if (meA.orgId) {
      orgId = meA.orgId;
    } else {
      const items = (await (await apiFetch('/work-items', userAToken)).json()) as Array<{
        org_id: string;
      }>;
      const first = items[0];
      assert(first, 'A has no work items to derive an org from');
      orgId = first.org_id;
    }
  });

  await test('A creates and shares a work item', async () => {
    const res = await apiFetch('/work-items', userAToken, {
      method: 'POST',
      body: JSON.stringify({ name: `Chat probe ${randomUUID().slice(0, 8)}`, org_id: orgId }),
    });
    assert(res.ok, `create failed: ${res.status}`);
    workItemId = ((await res.json()) as { id: string }).id;
    const share = await apiFetch(`/work-items/${workItemId}/members`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ email: userBEmail, role: 'edit' }),
    });
    assert(share.ok, `share failed: ${share.status}`);
  });

  let wsA: WebSocket | undefined;
  let wsB: WebSocket | undefined;
  const roomId = () => `work_item:${workItemId}`;

  await test('Both users join the work item room', async () => {
    wsA = await connectWs(userAToken);
    wsB = await connectWs(userBToken);
    wsA.send(JSON.stringify({ type: 'join_room', payload: { roomId: roomId() } }));
    await waitForMessage(wsA, 'room_joined');
    wsB.send(JSON.stringify({ type: 'join_room', payload: { roomId: roomId() } }));
    await waitForMessage(wsB, 'room_joined');
  });

  const clientMessageId = randomUUID();

  await test('B sends with client id: B gets ack, A gets broadcast', async () => {
    // Generous window: the first insert pays Neon connection warm-up.
    const ackPromise = waitForMessageWhere(
      wsB!,
      'chat_message_ack',
      (p) => (p as { id: string }).id === clientMessageId,
      15_000
    );
    const broadcastPromise = waitForMessageWhere(
      wsA!,
      'chat_message_received',
      (p) => (p as { id: string }).id === clientMessageId,
      15_000
    );
    wsB!.send(
      JSON.stringify({
        type: 'chat_message',
        payload: { id: clientMessageId, work_item_id: workItemId, content: 'probe: first send' },
      })
    );
    const [ackFrame, broadcastFrame] = await Promise.all([ackPromise, broadcastPromise]);
    const ack = ackFrame.payload as { id: string; created_at: string };
    const broadcast = broadcastFrame.payload as { id: string; created_at: string };
    assert(ack.created_at === broadcast.created_at, 'ack/broadcast created_at mismatch');
  });

  await test('Retry with same id echoes stored row, never re-broadcasts', async () => {
    const rebroadcast = waitForMessageWhere(
      wsA!,
      'chat_message_received',
      (p) => (p as { id: string }).id === clientMessageId,
      1500
    ).then(
      () => true,
      () => false
    );
    const ackPromise = waitForMessageWhere(
      wsB!,
      'chat_message_ack',
      (p) => (p as { id: string }).id === clientMessageId
    );
    wsB!.send(
      JSON.stringify({
        type: 'chat_message',
        payload: {
          id: clientMessageId,
          work_item_id: workItemId,
          content: 'probe: RESENT DIFFERENT CONTENT',
        },
      })
    );
    await ackPromise;
    assert(!(await rebroadcast), 'conflict no-op must not broadcast resent content');
    const page = await apiFetch(`/work-items/${workItemId}/messages`, userAToken);
    const rows = (await page.json()) as ChatRow[];
    const stored = rows.find((r) => r.id === clientMessageId);
    assert(stored?.content === 'probe: first send', 'stored content was rewritten on conflict');
  });

  await test('Foreign claim on an existing id is rejected', async () => {
    const errorPromise = waitForMessage(wsA!, 'error', 3000);
    wsA!.send(
      JSON.stringify({
        type: 'chat_message',
        payload: { id: clientMessageId, work_item_id: workItemId, content: 'probe: hijack' },
      })
    );
    const frame = await errorPromise;
    assert(
      String(frame.payload).includes('conflict'),
      `expected id-conflict error, got: ${String(frame.payload)}`
    );
  });

  await test('Keyset pagination: stable boundaries, id tiebreaker', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await apiFetch(`/work-items/${workItemId}/messages`, userAToken, {
        method: 'POST',
        body: JSON.stringify({ content: `probe: page ${i}` }),
      });
      assert(res.status === 201, `POST ${i} failed: ${res.status}`);
    }
    const all = (await (
      await apiFetch(`/work-items/${workItemId}/messages?limit=100`, userAToken)
    ).json()) as ChatRow[];
    assert(all.length >= 6, `expected 6+ rows, got ${all.length}`);

    const newest = (await (
      await apiFetch(`/work-items/${workItemId}/messages?limit=2`, userAToken)
    ).json()) as ChatRow[];
    const [newest0, newest1] = newest;
    const secondLast = all[all.length - 2];
    const last = all[all.length - 1];
    const thirdLast = all[all.length - 3];
    assert(newest0 && newest1 && secondLast && last && thirdLast, 'newest page size');
    assert(
      newest0.id === secondLast.id && newest1.id === last.id,
      'newest page must be the last two rows ascending'
    );

    const older = (await (
      await apiFetch(
        `/work-items/${workItemId}/messages?limit=2&before=${encodeURIComponent(cursorOf(newest0))}`,
        userAToken
      )
    ).json()) as ChatRow[];
    const olderLast = older[older.length - 1];
    assert(older.length === 2 && olderLast, 'older page size');
    assert(
      olderLast.id === thirdLast.id,
      'before-page must butt up against the newest page with no gap or overlap'
    );

    const after = (await (
      await apiFetch(
        `/work-items/${workItemId}/messages?after=${encodeURIComponent(cursorOf(olderLast))}`,
        userAToken
      )
    ).json()) as ChatRow[];
    assert(
      after.length === 2 && after[0]?.id === newest0.id,
      'after-cursor must return exactly the newer rows'
    );
  });

  const turnId = randomUUID();
  const agentTurnRow = {
    id: randomUUID(),
    content: '',
    sender_type: 'agent',
    sender_name: 'Chord Agent',
    message_type: 'agent_turn',
    created_at: new Date(Date.now() - 60_000).toISOString(),
    metadata: { turnId, items: [{ kind: 'text', id: 't1', text: 'probe turn' }] },
  };
  const humanRow = {
    id: randomUUID(),
    content: 'probe: backfilled human row',
    sender_type: 'human',
    sender_name: 'Owner',
    message_type: 'text',
    created_at: new Date(Date.now() - 120_000).toISOString(),
    metadata: {},
  };
  const bulkRows = [agentTurnRow, humanRow];

  await test('Participant bulk PUT is rejected with 403', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/messages/bulk`, userBToken, {
      method: 'PUT',
      body: JSON.stringify({ messages: bulkRows }),
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  await test('Creator bulk PUT inserts, broadcasts, and accepts empty agent content', async () => {
    const liveTurn = waitForMessageWhere(
      wsB!,
      'chat_message_received',
      (p) => (p as { id: string }).id === agentTurnRow.id
    );
    const res = await apiFetch(`/work-items/${workItemId}/messages/bulk`, userAToken, {
      method: 'PUT',
      body: JSON.stringify({ messages: bulkRows }),
    });
    if (!res.ok) assert(false, `bulk PUT failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { inserted: number; existing: number };
    assert(body.inserted === 2, `expected 2 inserted, got ${body.inserted}`);
    const frame = (await liveTurn).payload as {
      sender_type: string;
      created_at: string;
      metadata: { turnId?: string };
    };
    assert(frame.sender_type === 'agent', 'bulk broadcast must preserve sender_type');
    assert(frame.metadata.turnId === turnId, 'bulk broadcast must carry turn metadata');
    assert(
      new Date(frame.created_at).getTime() === new Date(agentTurnRow.created_at).getTime(),
      'bulk insert must preserve the original timestamp'
    );
  });

  await test('Bulk replay is idempotent and broadcasts nothing', async () => {
    const rebroadcast = waitForMessageWhere(
      wsB!,
      'chat_message_received',
      (p) => (p as { id: string }).id === agentTurnRow.id,
      1500
    ).then(
      () => true,
      () => false
    );
    const res = await apiFetch(`/work-items/${workItemId}/messages/bulk`, userAToken, {
      method: 'PUT',
      body: JSON.stringify({ messages: bulkRows }),
    });
    const body = (await res.json()) as { inserted: number; existing: number };
    assert(body.inserted === 0 && body.existing === 2, 'replay must insert nothing');
    assert(!(await rebroadcast), 'idempotent replay must not broadcast');
  });

  await test('Bulk id colliding with another work item returns 409', async () => {
    const create = await apiFetch('/work-items', userAToken, {
      method: 'POST',
      body: JSON.stringify({ name: `Chat probe 2 ${randomUUID().slice(0, 8)}`, org_id: orgId }),
    });
    const otherItemId = ((await create.json()) as { id: string }).id;
    const res = await apiFetch(`/work-items/${otherItemId}/messages/bulk`, userAToken, {
      method: 'PUT',
      body: JSON.stringify({ messages: [humanRow] }),
    });
    assert(res.status === 409, `expected 409, got ${res.status}`);
    const body = (await res.json()) as { ids: string[] };
    assert(body.ids.includes(humanRow.id), '409 must list the offending ids');
  });

  wsA?.close();
  wsB?.close();
  printSummaryAndExit();
}

run().catch((err) => {
  console.error('Chat probe runner failed:', err);
  process.exit(1);
});
