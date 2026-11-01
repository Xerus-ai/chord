import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  apiFetch,
  assert,
  connectWs,
  printSummaryAndExit,
  requireTokens,
  test,
  waitForMessage,
  waitForMessageWhere,
  WS_URL,
} from './e2e-harness.js';

/**
 * Live protocol probe for the Command Channel server surface (design §1–§4):
 * Slice 1 covers tier/policy gating on command insert, the atomic
 * prompt+chat batch, the commands_available doorbell, device presence, and
 * the fetch/claim/ack lifecycle with its claim race; Slice 5 covers the
 * permission-request publication upsert (creator gate, one-way transitions),
 * the approval_policy PATCH, the policy gate on permission_response inserts,
 * and the fetch-row policy snapshot the inbox executor re-validates against.
 * Run with two real user JWTs against the live dev stack:
 *   USER_A_TOKEN=... USER_B_TOKEN=... npx tsx src/e2e-commands-probe.ts
 * A is the work item creator (owner of the "device"); B the participant issuer.
 */

const { userAToken, userBToken } = requireTokens();

function connectDeviceWs(token: string, deviceId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}&device_id=${deviceId}`);
    const timeout = setTimeout(() => reject(new Error('device WS connect timeout')), 5000);
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on('error', (err) => reject(err));
  });
}

// Template-literal assert messages must never contain `await res.text()` —
// the message is built before assert runs, consuming the body even on
// success and making the subsequent res.json() throw. Read once, parse once.
async function readBody<T>(res: Response): Promise<{ raw: string; json: T }> {
  const raw = await res.text();
  let json: T;
  try {
    json = JSON.parse(raw) as T;
  } catch {
    json = undefined as T;
  }
  return { raw, json };
}

interface CommandRow {
  id: string;
  work_item_id: string;
  kind: string;
  status: string;
  status_reason: string | null;
  claimed_by_device: string | null;
  payload: Record<string, unknown>;
  expires_at: string | null;
}

async function run(): Promise<void> {
  console.log('\n=== Chord Command-Channel Probe (Slices 1 + 5) ===\n');

  const deviceId = `probe-device-${randomUUID().slice(0, 8)}`;
  const rivalDeviceId = `probe-rival-${randomUUID().slice(0, 8)}`;
  let orgId = '';
  let userBEmail = '';
  let memberBId = '';
  let workItemId = '';

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

  await test('A creates and shares a work item', async () => {
    const res = await apiFetch('/work-items', userAToken, {
      method: 'POST',
      body: JSON.stringify({ name: `Commands probe ${randomUUID().slice(0, 8)}`, org_id: orgId }),
    });
    assert(res.ok, `create failed: ${res.status}`);
    workItemId = ((await res.json()) as { id: string }).id;
    const share = await apiFetch(`/work-items/${workItemId}/members`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ email: userBEmail, role: 'edit' }),
    });
    assert(share.ok, `share failed: ${share.status}`);
    memberBId = ((await share.json()) as { id: string }).id;
  });

  await test('Work item defaults: approval_policy owner, delivery_policy manual', async () => {
    const res = await apiFetch(`/work-items/${workItemId}`, userAToken);
    assert(res.ok, `get failed: ${res.status}`);
    const item = (await res.json()) as {
      approval_policy: string;
      delivery_policy: string;
      creator_device_online: boolean;
    };
    assert(item.approval_policy === 'owner', `approval_policy: ${item.approval_policy}`);
    assert(item.delivery_policy === 'manual', `delivery_policy: ${item.delivery_policy}`);
    assert(item.creator_device_online === false, 'device reported online before connect');
  });

  let wsB: WebSocket | undefined;
  let deviceWs: WebSocket | undefined;

  await test('B joins the work item room', async () => {
    wsB = await connectWs(userBToken);
    wsB.send(JSON.stringify({ type: 'join_room', payload: { roomId: `work_item:${workItemId}` } }));
    await waitForMessage(wsB, 'room_joined');
  });

  await test('Device connect flips creator_device_online and broadcasts to the room', async () => {
    const presencePromise = waitForMessageWhere(
      wsB!,
      'device_presence_changed',
      (p) => (p as { online: boolean }).online === true
    );
    presencePromise.catch(() => {});
    deviceWs = await connectDeviceWs(userAToken, deviceId);
    await presencePromise;
    const res = await apiFetch(`/work-items/${workItemId}`, userBToken);
    const item = (await res.json()) as { creator_device_online: boolean };
    assert(item.creator_device_online === true, 'creator_device_online still false');
  });

  let interruptId = '';
  let promptId = '';
  let promptChatMessageId = '';

  await test('B posts an interrupt; device gets the doorbell; expiry stamped', async () => {
    const doorbell = waitForMessageWhere(
      deviceWs!,
      'commands_available',
      (p) => (p as { work_item_id: string }).work_item_id === workItemId
    );
    doorbell.catch(() => {});
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userBToken, {
      method: 'POST',
      body: JSON.stringify({ kind: 'interrupt', payload: {} }),
    });
    const { raw, json: cmd } = await readBody<CommandRow>(res);
    assert(res.status === 201, `insert failed: ${res.status} ${raw}`);
    interruptId = cmd.id;
    assert(cmd.status === 'pending', `status: ${cmd.status}`);
    assert(cmd.expires_at !== null, 'interrupt must carry expires_at');
    await doorbell;
  });

  await test('B posts a prompt; chat row lands atomically and broadcasts', async () => {
    const chatPromise = waitForMessageWhere(
      wsB!,
      'chat_message_received',
      (p) => (p as { metadata?: { agent_prompt?: boolean } }).metadata?.agent_prompt === true
    );
    chatPromise.catch(() => {});
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userBToken, {
      method: 'POST',
      body: JSON.stringify({ kind: 'prompt', payload: { content: 'probe: run the tests' } }),
    });
    const { raw, json: cmd } = await readBody<CommandRow>(res);
    assert(res.status === 201, `insert failed: ${res.status} ${raw}`);
    promptId = cmd.id;
    promptChatMessageId = cmd.payload.chat_message_id as string;
    assert(promptChatMessageId, 'prompt payload must carry chat_message_id');
    assert(cmd.expires_at === null, 'prompt must never expire server-side');
    const chatMsg = (await chatPromise) as {
      payload: { id: string; metadata: { command_id: string } };
    };
    assert(chatMsg.payload.id === promptChatMessageId, 'chat row id != payload.chat_message_id');
    assert(chatMsg.payload.metadata.command_id === promptId, 'chat metadata missing command_id');
    assert(promptId > interruptId, 'uuidv7 ids must sort in insertion order');
  });

  await test('Command ids sort in issue order (uuidv7)', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userBToken);
    const rows = (await res.json()) as CommandRow[];
    assert(rows.length === 2, `expected 2 commands, got ${rows.length}`);
    assert(rows[0]!.id === interruptId && rows[1]!.id === promptId, 'GET not in ascending order');
  });

  await test('permission_response under approval_policy=owner is 403 for B', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userBToken, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'permission_response',
        payload: { request_id: 'nonexistent', option_id: 'allow_once' },
      }),
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  await test('permission_response for a missing request is 404 for the owner', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userAToken, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'permission_response',
        payload: { request_id: 'nonexistent', option_id: 'allow_once' },
      }),
    });
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  await test('Unknown kind is rejected at the schema gate', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userBToken, {
      method: 'POST',
      body: JSON.stringify({ kind: 'self_destruct', payload: {} }),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test('Device fetch returns both commands ascending; scoped to local ids', async () => {
    const res = await apiFetch('/commands/fetch', userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, work_item_ids: [workItemId] }),
    });
    assert(res.ok, `fetch failed: ${res.status}`);
    const rows = (await res.json()) as CommandRow[];
    assert(rows.length === 2, `expected 2, got ${rows.length}`);
    assert(rows[0]!.id === interruptId, 'fetch not ascending');

    const empty = await apiFetch('/commands/fetch', userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, work_item_ids: [] }),
    });
    assert(((await empty.json()) as CommandRow[]).length === 0, 'empty id list must return []');
  });

  await test('Non-creator fetch/claim is denied', async () => {
    const res = await apiFetch('/commands/fetch', userBToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: 'b-device', work_item_ids: [workItemId] }),
    });
    const rows = (await res.json()) as CommandRow[];
    assert(rows.length === 0, 'B (participant) must fetch nothing');

    const claim = await apiFetch(`/commands/${interruptId}/claim`, userBToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: 'b-device' }),
    });
    assert(claim.status === 403, `expected 403, got ${claim.status}`);
  });

  await test('Claim race: one device wins, the loser gets 409', async () => {
    const [first, second] = await Promise.all([
      apiFetch(`/commands/${interruptId}/claim`, userAToken, {
        method: 'POST',
        body: JSON.stringify({ device_id: deviceId }),
      }),
      apiFetch(`/commands/${interruptId}/claim`, userAToken, {
        method: 'POST',
        body: JSON.stringify({ device_id: rivalDeviceId }),
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert(
      statuses[0] === 200 && statuses[1] === 409,
      `expected one 200 + one 409, got ${statuses.join(',')}`
    );
  });

  await test('Claim transition broadcast reached the room', async () => {
    // The race above already fired it; a fresh claim of the prompt gives us
    // a deterministic frame to await.
    const updatePromise = waitForMessageWhere(
      wsB!,
      'command_updated',
      (p) => (p as { id: string; status: string }).id === promptId
    );
    updatePromise.catch(() => {});
    const res = await apiFetch(`/commands/${promptId}/claim`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
    });
    assert(res.ok, `claim failed: ${res.status}`);
    const frame = (await updatePromise) as { payload: { status: string } };
    assert(frame.payload.status === 'claimed', `broadcast status: ${frame.payload.status}`);
  });

  await test('Re-claim by the same device echoes the row (idempotent retry)', async () => {
    const res = await apiFetch(`/commands/${promptId}/claim`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const row = (await res.json()) as CommandRow;
    assert(row.claimed_by_device === deviceId, 'claim holder changed on retry');
  });

  await test('Fetch recovers claimed-but-unacked rows for the claiming device only', async () => {
    const winner = await apiFetch('/commands/fetch', userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, work_item_ids: [workItemId] }),
    });
    const winnerRows = (await winner.json()) as CommandRow[];
    const winnerClaimed = winnerRows.filter((r) => r.status === 'claimed');
    assert(
      winnerRows.length >= 1 && winnerClaimed.some((r) => r.claimed_by_device === deviceId),
      'claiming device must refetch its unacked claims'
    );

    // The rival lost both races/claims — nothing pending, nothing of its own.
    const rival = await apiFetch('/commands/fetch', userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: rivalDeviceId, work_item_ids: [workItemId] }),
    });
    const rivalRows = (await rival.json()) as CommandRow[];
    const claimedByRival = rivalRows.filter((r) => r.claimed_by_device === rivalDeviceId);
    assert(claimedByRival.length === 0, 'rival must not see another device claims');
  });

  await test('Ack by a non-claiming device is 409; failed ack requires reason', async () => {
    const wrongDevice = await apiFetch(`/commands/${promptId}/ack`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: rivalDeviceId, status: 'acked' }),
    });
    assert(wrongDevice.status === 409, `expected 409, got ${wrongDevice.status}`);

    const noReason = await apiFetch(`/commands/${interruptId}/ack`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, status: 'failed' }),
    });
    assert(noReason.status === 400, `expected 400, got ${noReason.status}`);
  });

  await test('Ack terminal transitions broadcast and persist', async () => {
    const promptDone = waitForMessageWhere(
      wsB!,
      'command_updated',
      (p) =>
        (p as { id: string; status: string }).id === promptId &&
        (p as { status: string }).status === 'acked'
    );
    const ackPrompt = await apiFetch(`/commands/${promptId}/ack`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, status: 'acked' }),
    });
    assert(ackPrompt.ok, `ack failed: ${ackPrompt.status}`);
    await promptDone;

    const interruptClaimHolder = (await (
      await apiFetch(`/work-items/${workItemId}/commands?status=claimed`, userAToken)
    ).json()) as CommandRow[];
    const interruptRow = interruptClaimHolder.find((r) => r.id === interruptId);
    assert(interruptRow, 'interrupt should still be claimed');
    const failRes = await apiFetch(`/commands/${interruptId}/ack`, userAToken, {
      method: 'POST',
      body: JSON.stringify({
        device_id: interruptRow.claimed_by_device,
        status: 'failed',
        status_reason: 'agent not running',
      }),
    });
    assert(failRes.ok, `failed-ack failed: ${failRes.status}`);
    const failed = (await failRes.json()) as CommandRow;
    assert(failed.status_reason === 'agent not running', 'status_reason not persisted');
  });

  // ─── Slice 5: approvals (design §4) ────────────────────────────────────
  // The server surface only: publication upsert, its creator gate and
  // one-way transitions, the approval_policy PATCH, the policy gate on
  // permission_response inserts, and the fetch-row policy snapshot the
  // inbox executor re-validates against. Actual answer execution
  // (respondToWorkItemPermission) is main-process and needs the live app.

  const permRequestId = `probe-perm-${randomUUID().slice(0, 8)}`;
  const permOptions = [
    { optionId: 'opt-allow', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'opt-deny', name: 'Deny', kind: 'reject_once' },
  ];

  await test('Owner publishes a permission request; broadcasts pending and lands in GET', async () => {
    const published = waitForMessageWhere(
      wsB!,
      'permission_request_updated',
      (p) =>
        (p as { request_id: string; status: string }).request_id === permRequestId &&
        (p as { status: string }).status === 'pending'
    );
    published.catch(() => {});
    const res = await apiFetch(
      `/work-items/${workItemId}/permission-requests/${permRequestId}`,
      userAToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          work_item_id: workItemId,
          tool_name: 'Bash',
          input: { command: 'ls -la' },
          options: permOptions,
          status: 'pending',
        }),
      }
    );
    assert(res.status === 201, `publish failed: ${res.status}`);
    await published;

    const list = (await (
      await apiFetch(`/work-items/${workItemId}/permission-requests?status=pending`, userBToken)
    ).json()) as Array<{ request_id: string; tool_name: string }>;
    const found = list.find((r) => r.request_id === permRequestId);
    assert(found?.tool_name === 'Bash', 'published request not in participant GET');
  });

  await test('Non-creator PUT permission-request is 403', async () => {
    const res = await apiFetch(
      `/work-items/${workItemId}/permission-requests/${permRequestId}`,
      userBToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          work_item_id: workItemId,
          status: 'resolved',
          resolution: 'allow_once',
        }),
      }
    );
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  await test('Bare resolve for an unknown request is 409, not 404', async () => {
    // 404 would trip the sync-queue child-entity requeue-forever policy —
    // a resolve with no create body is a client bug, not a missing parent.
    const res = await apiFetch(
      `/work-items/${workItemId}/permission-requests/never-published-${randomUUID().slice(0, 6)}`,
      userAToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          work_item_id: workItemId,
          status: 'resolved',
          resolution: 'allow_once',
        }),
      }
    );
    assert(res.status === 409, `expected 409, got ${res.status}`);
  });

  await test('approval-policy PATCH is creator-only and broadcasts work_item_updated', async () => {
    const denied = await apiFetch(`/work-items/${workItemId}/approval-policy`, userBToken, {
      method: 'PATCH',
      body: JSON.stringify({ approval_policy: 'participants' }),
    });
    assert(denied.status === 403, `expected 403 for participant, got ${denied.status}`);

    const updated = waitForMessageWhere(
      wsB!,
      'work_item_updated',
      (p) =>
        (p as { changes?: { approval_policy?: string } }).changes?.approval_policy ===
        'participants'
    );
    updated.catch(() => {});
    const res = await apiFetch(`/work-items/${workItemId}/approval-policy`, userAToken, {
      method: 'PATCH',
      body: JSON.stringify({ approval_policy: 'participants' }),
    });
    assert(res.ok, `owner PATCH failed: ${res.status}`);
    const item = (await res.json()) as { approval_policy: string };
    assert(item.approval_policy === 'participants', `policy: ${item.approval_policy}`);
    await updated;
  });

  let permResponseId = '';

  await test('Under approval_policy=participants, B may answer via permission_response', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userBToken, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'permission_response',
        payload: { request_id: permRequestId, option_id: 'allow_once' },
      }),
    });
    const { raw, json: cmd } = await readBody<CommandRow>(res);
    assert(res.status === 201, `participant answer failed: ${res.status} ${raw}`);
    permResponseId = cmd.id;
    // Inherits the permission request's 24h expiry, not the interrupt's 10m.
    assert(cmd.expires_at !== null, 'permission_response must inherit an expiry');
  });

  await test('Device fetch embeds the approval-policy snapshot for the executor', async () => {
    const res = await apiFetch('/commands/fetch', userAToken, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, work_item_ids: [workItemId] }),
    });
    const rows = (await res.json()) as Array<
      CommandRow & { work_item_creator_id?: string; work_item_approval_policy?: string }
    >;
    const answer = rows.find((r) => r.id === permResponseId);
    assert(answer, 'permission_response not returned to the device');
    assert(
      answer.work_item_approval_policy === 'participants',
      `snapshot policy: ${answer.work_item_approval_policy}`
    );
    assert(!!answer.work_item_creator_id, 'fetch row missing creator snapshot');
  });

  await test('Owner retraction resolves the request; broadcast + GET clears', async () => {
    const resolved = waitForMessageWhere(
      wsB!,
      'permission_request_updated',
      (p) =>
        (p as { request_id: string; status: string }).request_id === permRequestId &&
        (p as { status: string }).status === 'resolved'
    );
    resolved.catch(() => {});
    const res = await apiFetch(
      `/work-items/${workItemId}/permission-requests/${permRequestId}`,
      userAToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          work_item_id: workItemId,
          status: 'resolved',
          resolution: 'allow_once',
          resolved_by: null,
        }),
      }
    );
    assert(res.ok, `retraction failed: ${res.status}`);
    await resolved;

    const list = (await (
      await apiFetch(`/work-items/${workItemId}/permission-requests?status=pending`, userAToken)
    ).json()) as Array<{ request_id: string }>;
    assert(!list.some((r) => r.request_id === permRequestId), 'resolved request still pending');
  });

  await test('Terminal transitions are one-way: a second resolve echoes, never flips', async () => {
    const res = await apiFetch(
      `/work-items/${workItemId}/permission-requests/${permRequestId}`,
      userAToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          work_item_id: workItemId,
          status: 'expired',
          resolution: 'expired',
        }),
      }
    );
    assert(res.ok, `echo PUT failed: ${res.status}`);
    const row = (await res.json()) as { status: string; resolution: string };
    assert(row.status === 'resolved', `terminal row flipped to ${row.status}`);
    assert(row.resolution === 'allow_once', `resolution overwritten: ${row.resolution}`);
  });

  await test('A late permission_response for a resolved request is 409', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userAToken, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'permission_response',
        payload: { request_id: permRequestId, option_id: 'allow_once' },
      }),
    });
    assert(res.status === 409, `expected 409 for resolved request, got ${res.status}`);
  });

  await test('Reset approval_policy to owner before the viewer checks', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/approval-policy`, userAToken, {
      method: 'PATCH',
      body: JSON.stringify({ approval_policy: 'owner' }),
    });
    assert(res.ok, `reset failed: ${res.status}`);
  });

  await test('Viewer cannot insert commands', async () => {
    // Drop B to Can view, then attempt an interrupt.
    const demote = await apiFetch(`/work-items/${workItemId}/members/${memberBId}`, userAToken, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'view' }),
    });
    assert(demote.ok, `demote failed: ${demote.status}`);
    const res = await apiFetch(`/work-items/${workItemId}/commands`, userBToken, {
      method: 'POST',
      body: JSON.stringify({ kind: 'interrupt', payload: {} }),
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  await test('Device disconnect broadcasts offline and clears the GET boolean', async () => {
    // A Can view member keeps room access; re-joining is idempotent and makes
    // sure B's socket is in the room before the device drops.
    wsB!.send(
      JSON.stringify({ type: 'join_room', payload: { roomId: `work_item:${workItemId}` } })
    );
    await waitForMessage(wsB!, 'room_joined');
    const offlinePromise = waitForMessageWhere(
      wsB!,
      'device_presence_changed',
      (p) => (p as { online: boolean }).online === false
    );
    offlinePromise.catch(() => {});
    deviceWs!.close();
    await offlinePromise;
    const res = await apiFetch(`/work-items/${workItemId}`, userBToken);
    const item = (await res.json()) as { creator_device_online: boolean };
    assert(item.creator_device_online === false, 'creator_device_online still true');
  });

  await test('Cleanup: A deletes the work item (commands cascade)', async () => {
    const res = await apiFetch(`/work-items/${workItemId}`, userAToken, { method: 'DELETE' });
    assert(res.status === 204, `delete failed: ${res.status}`);
  });

  wsB?.close();
  printSummaryAndExit();
}

run().catch((err) => {
  console.error('Probe crashed:', err);
  process.exit(1);
});
