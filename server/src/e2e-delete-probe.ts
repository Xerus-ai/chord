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
 * Live protocol probe for the deletion lifecycle (plan Phase E): creator-only
 * gating on DELETE, delete → confirm → broadcast order, and post-delete
 * convergence via 404. The full cascade graph (incl. artifact comment and
 * version grandchildren + notifications SET NULL) is verified against Neon
 * directly — this probe covers everything reachable over the wire. Run:
 *   USER_A_TOKEN=... USER_B_TOKEN=... npx tsx src/e2e-delete-probe.ts
 */

const { userAToken, userBToken } = requireTokens();

async function run(): Promise<void> {
  console.log('\n=== Chord Delete Protocol Probe (Phase E) ===\n');

  let orgId = '';
  let userBEmail = '';
  let workItemId = '';
  const artifactId = randomUUID();

  await test('Both users authenticate', async () => {
    const resA = await apiFetch('/me', userAToken);
    assert(resA.ok, `A auth failed: ${resA.status}`);
    const meA = (await resA.json()) as { orgId: string | null };
    const resB = await apiFetch('/me', userBToken);
    assert(resB.ok, `B auth failed: ${resB.status}`);
    const meB = (await resB.json()) as { userId: string; email: string };
    userBEmail = meB.email;
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

  await test('A creates a shared item carrying messages and an artifact with a comment', async () => {
    const res = await apiFetch('/work-items', userAToken, {
      method: 'POST',
      body: JSON.stringify({ name: `Delete probe ${randomUUID().slice(0, 8)}`, org_id: orgId }),
    });
    assert(res.ok, `create failed: ${res.status}`);
    workItemId = ((await res.json()) as { id: string }).id;

    const share = await apiFetch(`/work-items/${workItemId}/members`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ email: userBEmail, role: 'edit' }),
    });
    assert(share.ok, `share failed: ${share.status}`);

    const message = await apiFetch(`/work-items/${workItemId}/messages`, userBToken, {
      method: 'POST',
      body: JSON.stringify({ content: 'delete probe message' }),
    });
    assert(message.status === 201, `message failed: ${message.status}`);

    const artifact = await apiFetch(`/work-items/${workItemId}/artifacts`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ id: artifactId, name: 'Delete probe artifact' }),
    });
    assert(artifact.status === 201, `artifact failed: ${artifact.status}`);

    const comment = await apiFetch(
      `/work-items/${workItemId}/artifacts/${artifactId}/comments`,
      userBToken,
      { method: 'POST', body: JSON.stringify({ body: 'delete probe comment' }) }
    );
    assert(comment.ok, `comment failed: ${comment.status} ${await comment.text()}`);
  });

  let wsB: WebSocket | undefined;

  await test('B joins the work item room', async () => {
    wsB = await connectWs(userBToken);
    wsB.send(JSON.stringify({ type: 'join_room', payload: { roomId: `work_item:${workItemId}` } }));
    await waitForMessage(wsB, 'room_joined');
  });

  await test('Participant DELETE is rejected with 403 and broadcasts nothing', async () => {
    const broadcastArrived = waitForMessageWhere(
      wsB!,
      'work_item_deleted',
      (p) => (p as { work_item_id: string }).work_item_id === workItemId,
      1500
    ).then(
      () => true,
      () => false
    );
    const res = await apiFetch(`/work-items/${workItemId}`, userBToken, { method: 'DELETE' });
    assert(res.status === 403, `expected 403, got ${res.status}`);
    assert(!(await broadcastArrived), 'a rejected delete must never broadcast');
    const still = await apiFetch(`/work-items/${workItemId}`, userAToken);
    assert(still.ok, 'item must survive a participant delete attempt');
  });

  await test('Creator DELETE returns 204 and B receives work_item_deleted', async () => {
    const broadcastPromise = waitForMessageWhere(
      wsB!,
      'work_item_deleted',
      (p) => (p as { work_item_id: string }).work_item_id === workItemId,
      15_000
    );
    const res = await apiFetch(`/work-items/${workItemId}`, userAToken, { method: 'DELETE' });
    assert(res.status === 204, `expected 204, got ${res.status}: ${await res.text()}`);
    const frame = await broadcastPromise;
    const payload = frame.payload as { work_item_id: string };
    assert(payload.work_item_id === workItemId, 'broadcast must carry top-level work_item_id');
  });

  await test('Everything under the item converges to 404 for both users', async () => {
    for (const [label, token] of [
      ['A', userAToken],
      ['B', userBToken],
    ] as const) {
      const item = await apiFetch(`/work-items/${workItemId}`, token);
      assert(item.status === 404, `${label}: item GET expected 404, got ${item.status}`);
      const messages = await apiFetch(`/work-items/${workItemId}/messages`, token);
      assert(messages.status === 404, `${label}: messages expected 404, got ${messages.status}`);
      const artifacts = await apiFetch(`/work-items/${workItemId}/artifacts`, token);
      assert(artifacts.status === 404, `${label}: artifacts expected 404, got ${artifacts.status}`);
      const gitState = await apiFetch(`/work-items/${workItemId}/git-state`, token);
      assert(gitState.status === 404, `${label}: git-state expected 404, got ${gitState.status}`);
    }
  });

  await test('Deleting an already-deleted item returns 404', async () => {
    const res = await apiFetch(`/work-items/${workItemId}`, userAToken, { method: 'DELETE' });
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  wsB?.close();
  printSummaryAndExit();
}

run().catch((err) => {
  console.error('Delete probe runner failed:', err);
  process.exit(1);
});
