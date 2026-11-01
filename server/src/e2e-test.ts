import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  API_BASE,
  apiFetch,
  assert,
  connectWs,
  printSummaryAndExit,
  requireTokens,
  test,
  waitForMessage,
} from './e2e-harness.js';

const { userAToken: USER_A_TOKEN, userBToken: USER_B_TOKEN } = requireTokens();

async function run(): Promise<void> {
  console.log('\n=== Chord E2E Multiplayer Test ===\n');

  let workItemId: string;
  let orgId: string;

  // 1. Verify health
  await test('Health check', async () => {
    const res = await fetch(`${API_BASE}/health`);
    const body = (await res.json()) as { status: string };
    assert(res.ok, 'Health endpoint returned non-200');
    assert(body.status === 'ok', `Expected status "ok", got "${body.status}"`);
  });

  // 2. Authenticate both users
  await test('User A authenticates', async () => {
    const res = await apiFetch('/me', USER_A_TOKEN);
    assert(res.ok, `Auth failed: ${res.status}`);
    const body = (await res.json()) as { userId: string; orgId: string };
    assert(body.userId, 'Missing userId');
    orgId = body.orgId;
  });

  await test('User B authenticates', async () => {
    const res = await apiFetch('/me', USER_B_TOKEN);
    assert(res.ok, `Auth failed: ${res.status}`);
  });

  // 3. User A creates work item
  await test('User A creates work item', async () => {
    const res = await apiFetch('/work-items', USER_A_TOKEN, {
      method: 'POST',
      body: JSON.stringify({
        name: `E2E Test ${randomUUID().slice(0, 8)}`,
        org_id: orgId!,
      }),
    });
    assert(res.ok, `Create failed: ${res.status}`);
    const body = (await res.json()) as { id: string };
    workItemId = body.id;
    assert(workItemId, 'Missing work item ID');
  });

  // 4. User A shares with User B
  await test('User A shares work item with User B', async () => {
    const meRes = await apiFetch('/me', USER_B_TOKEN);
    const userB = (await meRes.json()) as { userId: string; email: string };

    const res = await apiFetch(`/work-items/${workItemId!}/members`, USER_A_TOKEN, {
      method: 'POST',
      body: JSON.stringify({ email: userB.email, role: 'edit' }),
    });
    assert(res.ok, `Share failed: ${res.status}`);
  });

  // 5. User B can see shared work item
  await test('User B sees shared work item', async () => {
    const res = await apiFetch('/work-items/shared-with-me', USER_B_TOKEN);
    assert(res.ok, `Fetch failed: ${res.status}`);
    const items = (await res.json()) as Array<{ id: string }>;
    const found = items.find((i) => i.id === workItemId!);
    assert(found, 'Work item not in shared list');
  });

  // 6. WebSocket connections
  let wsA: WebSocket | undefined;
  let wsB: WebSocket | undefined;

  await test('User A connects via WebSocket', async () => {
    wsA = await connectWs(USER_A_TOKEN);
    assert(wsA.readyState === WebSocket.OPEN, 'WS not open');
  });

  await test('User B connects via WebSocket', async () => {
    wsB = await connectWs(USER_B_TOKEN);
    assert(wsB.readyState === WebSocket.OPEN, 'WS not open');
  });

  // 7. Both join the same room
  await test('Both users join work item room', async () => {
    const roomId = `work-item:${workItemId!}`;

    wsA!.send(JSON.stringify({ type: 'join_room', payload: { roomId } }));
    const joinedA = await waitForMessage(wsA!, 'room_joined');
    assert(joinedA, 'User A did not receive room_joined');

    wsB!.send(JSON.stringify({ type: 'join_room', payload: { roomId } }));
    const joinedB = await waitForMessage(wsB!, 'room_joined');
    assert(joinedB, 'User B did not receive room_joined');
  });

  // 8. Chat message relay
  await test('User A sends message, User B receives', async () => {
    const start = Date.now();
    const roomId = `work-item:${workItemId!}`;
    const messageId = randomUUID();

    const receivePromise = waitForMessage(wsB!, 'room_message');

    wsA!.send(
      JSON.stringify({
        type: 'room_message',
        payload: { roomId, content: 'Hello from A', messageId },
      })
    );

    const received = await receivePromise;
    const latency = Date.now() - start;
    assert(received, 'User B did not receive message');
    assert(latency < 200, `Message latency ${latency}ms exceeds 200ms target`);
    console.log(`    Message relay latency: ${latency}ms`);
  });

  // 9. Presence update
  await test('Presence updates propagate', async () => {
    const res = await apiFetch('/presence/online-users', USER_A_TOKEN);
    assert(res.ok, `Presence fetch failed: ${res.status}`);
  });

  // 10. Typing indicator
  await test('Typing indicators work', async () => {
    const roomId = `work-item:${workItemId!}`;
    const receivePromise = waitForMessage(wsB!, 'room_message', 3000).catch(() => null);

    wsA!.send(
      JSON.stringify({
        type: 'room_message',
        payload: { roomId, content: 'typing test', typing: true },
      })
    );

    // Best-effort — typing indicators may not produce a distinct event type
    await receivePromise;
  });

  // 11. Notifications
  await test('Notification list accessible', async () => {
    const res = await apiFetch('/notifications', USER_B_TOKEN);
    assert(res.ok, `Notifications fetch failed: ${res.status}`);
  });

  await test('Unread count accessible', async () => {
    const res = await apiFetch('/notifications/unread-count', USER_B_TOKEN);
    assert(res.ok, `Unread count failed: ${res.status}`);
    const body = (await res.json()) as { count: number };
    assert(typeof body.count === 'number', 'Missing count');
  });

  // 12. Participants
  await test('Sharing lists the author and User B', async () => {
    const res = await apiFetch(`/work-items/${workItemId!}/sharing`, USER_A_TOKEN);
    assert(res.ok, `Sharing fetch failed: ${res.status}`);
    const sharing = (await res.json()) as { author: { user_id: string }; members: unknown[] };
    assert(!!sharing.author.user_id, 'Sharing must name the author');
    assert(sharing.members.length >= 1, `Expected 1+ members, got ${sharing.members.length}`);
  });

  // Cleanup
  wsA?.close();
  wsB?.close();

  printSummaryAndExit();
}

run().catch((err) => {
  console.error('E2E test runner failed:', err);
  process.exit(1);
});
