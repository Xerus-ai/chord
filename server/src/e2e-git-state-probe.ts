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
 * Live protocol probe for the git snapshot pipeline (plan Phase D): creator
 * gating, the atomic upsert's captured_at guard and RETURNING-paired thin
 * ping, server-side caps, and lazy per-file content. Run with two real user
 * JWTs against the live dev stack:
 *   USER_A_TOKEN=... USER_B_TOKEN=... npx tsx src/e2e-git-state-probe.ts
 */

const { userAToken, userBToken } = requireTokens();

const FILE_SIDE_BYTE_CAP = 64 * 1024;

interface GitStatePing {
  work_item_id: string;
  version: number;
  captured_at: string;
  branch_name: string | null;
}

interface GitStateMeta {
  version: number;
  captured_at: string;
  branch_name: string | null;
  files: Array<{ path: string; content_omitted: boolean }>;
}

function snapshotBody(overrides: {
  captured_at: string;
  files?: unknown[];
  contents?: unknown[];
  branch_name?: string | null;
}) {
  return {
    captured_at: overrides.captured_at,
    branch_name: overrides.branch_name === undefined ? 'probe/branch' : overrides.branch_name,
    files: overrides.files ?? [],
    contents: overrides.contents ?? [],
  };
}

async function run(): Promise<void> {
  console.log('\n=== Chord Git-State Protocol Probe (Phase D) ===\n');

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
      body: JSON.stringify({ name: `Git probe ${randomUUID().slice(0, 8)}`, org_id: orgId }),
    });
    assert(res.ok, `create failed: ${res.status}`);
    workItemId = ((await res.json()) as { id: string }).id;
    const share = await apiFetch(`/work-items/${workItemId}/members`, userAToken, {
      method: 'POST',
      body: JSON.stringify({ email: userBEmail, role: 'edit' }),
    });
    assert(share.ok, `share failed: ${share.status}`);
  });

  let wsB: WebSocket | undefined;

  await test('B joins the work item room', async () => {
    wsB = await connectWs(userBToken);
    wsB.send(JSON.stringify({ type: 'join_room', payload: { roomId: `work_item:${workItemId}` } }));
    await waitForMessage(wsB, 'room_joined');
  });

  await test('GET before any push is 404 (never-synced)', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/git-state`, userBToken);
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  await test('Participant PUT git-state is rejected with 403', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/git-state`, userBToken, {
      method: 'PUT',
      body: JSON.stringify(snapshotBody({ captured_at: new Date().toISOString() })),
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  const atCapContent = 'a'.repeat(FILE_SIDE_BYTE_CAP);
  const t1 = new Date().toISOString();

  await test('At-cap snapshot round-trips; B receives a thin RETURNING-paired ping', async () => {
    const pingPromise = waitForMessageWhere(
      wsB!,
      'git_state_updated',
      (p) => (p as GitStatePing).work_item_id === workItemId,
      15_000
    );
    const res = await apiFetch(`/work-items/${workItemId}/git-state`, userAToken, {
      method: 'PUT',
      body: JSON.stringify(
        snapshotBody({
          captured_at: t1,
          files: [
            {
              path: 'src/at-cap.ts',
              status: 'modified',
              additions: 10,
              deletions: 2,
              content_omitted: false,
            },
            {
              path: 'assets/blob.bin',
              status: 'modified',
              additions: 0,
              deletions: 0,
              content_omitted: true,
            },
          ],
          contents: [{ path: 'src/at-cap.ts', original: atCapContent, modified: 'changed' }],
        })
      ),
    });
    if (!res.ok) assert(false, `PUT failed: ${res.status} ${await res.text()}`);
    const put = (await res.json()) as { version: number; captured_at: string };

    const frame = await pingPromise;
    const ping = frame.payload as GitStatePing & Record<string, unknown>;
    assert(ping.version === put.version, 'ping version must pair with the PUT response');
    assert(
      new Date(ping.captured_at).getTime() === new Date(put.captured_at).getTime(),
      'ping captured_at must pair with the PUT response'
    );
    // Thin ping only — snapshot content never rides the socket.
    const keys = Object.keys(ping).sort();
    assert(
      keys.join(',') === 'branch_name,captured_at,version,work_item_id',
      `ping must be thin, carried: ${keys.join(',')}`
    );

    const meta = (await (
      await apiFetch(`/work-items/${workItemId}/git-state`, userBToken)
    ).json()) as GitStateMeta;
    assert(meta.version === put.version, 'metadata version mismatch');
    assert(meta.files.length === 2, 'metadata must list both files');

    const file = (await (
      await apiFetch(
        `/work-items/${workItemId}/git-state/file?path=${encodeURIComponent('src/at-cap.ts')}`,
        userBToken
      )
    ).json()) as { original: string; modified: string };
    assert(file.original === atCapContent, 'at-cap original must round-trip exactly');
    assert(file.modified === 'changed', 'modified must round-trip');
  });

  await test('Over-cap content is rejected by the server backstop (400)', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/git-state`, userAToken, {
      method: 'PUT',
      body: JSON.stringify(
        snapshotBody({
          captured_at: new Date().toISOString(),
          files: [
            {
              path: 'src/huge.ts',
              status: 'modified',
              additions: 1,
              deletions: 1,
              content_omitted: false,
            },
          ],
          contents: [
            { path: 'src/huge.ts', original: 'a'.repeat(FILE_SIDE_BYTE_CAP + 1), modified: '' },
          ],
        })
      ),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test('Content for a file marked content_omitted is rejected (400)', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/git-state`, userAToken, {
      method: 'PUT',
      body: JSON.stringify(
        snapshotBody({
          captured_at: new Date().toISOString(),
          files: [
            {
              path: 'src/omitted.ts',
              status: 'modified',
              additions: 1,
              deletions: 1,
              content_omitted: true,
            },
          ],
          contents: [{ path: 'src/omitted.ts', original: 'x', modified: 'y' }],
        })
      ),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test('Out-of-order captured_at is superseded: no bump, no ping', async () => {
    const stale = new Date(new Date(t1).getTime() - 60_000).toISOString();
    const pingArrived = waitForMessageWhere(
      wsB!,
      'git_state_updated',
      (p) => (p as GitStatePing).work_item_id === workItemId,
      1500
    ).then(
      () => true,
      () => false
    );
    const before = (await (
      await apiFetch(`/work-items/${workItemId}/git-state`, userBToken)
    ).json()) as GitStateMeta;
    const res = await apiFetch(`/work-items/${workItemId}/git-state`, userAToken, {
      method: 'PUT',
      body: JSON.stringify(
        snapshotBody({ captured_at: stale, files: [], contents: [], branch_name: 'stale/branch' })
      ),
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = (await res.json()) as { superseded?: boolean };
    assert(body.superseded === true, 'stale PUT must report superseded');
    assert(!(await pingArrived), 'superseded PUT must not ping');
    const after = (await (
      await apiFetch(`/work-items/${workItemId}/git-state`, userBToken)
    ).json()) as GitStateMeta;
    assert(after.version === before.version, 'superseded PUT must not bump version');
    assert(after.files.length === before.files.length, 'superseded PUT must not replace files');
  });

  await test('Concurrent PUTs: every ping pairs version with its own capture', async () => {
    const pings: GitStatePing[] = [];
    const collect = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as { type: string; payload: GitStatePing };
      if (msg.type === 'git_state_updated' && msg.payload.work_item_id === workItemId) {
        pings.push(msg.payload);
      }
    };
    wsB!.on('message', collect);

    const tOlder = new Date(Date.now() + 1000).toISOString();
    const tNewer = new Date(Date.now() + 2000).toISOString();
    const put = (at: string, branch: string) =>
      apiFetch(`/work-items/${workItemId}/git-state`, userAToken, {
        method: 'PUT',
        body: JSON.stringify(snapshotBody({ captured_at: at, branch_name: branch })),
      });
    const [ra, rb] = await Promise.all([put(tOlder, 'race/older'), put(tNewer, 'race/newer')]);
    assert(ra.ok && rb.ok, `race PUTs failed: ${ra.status}/${rb.status}`);
    await new Promise((r) => setTimeout(r, 1500));
    wsB!.off('message', collect);

    assert(pings.length >= 1, 'at least the newer capture must ping');
    for (let i = 1; i < pings.length; i++) {
      assert(pings[i]!.version > pings[i - 1]!.version, 'ping versions must be increasing');
      assert(
        new Date(pings[i]!.captured_at).getTime() >= new Date(pings[i - 1]!.captured_at).getTime(),
        'ping captured_at must never regress — versions must pair with their own payloads'
      );
    }

    const meta = (await (
      await apiFetch(`/work-items/${workItemId}/git-state`, userBToken)
    ).json()) as GitStateMeta;
    const lastPing = pings[pings.length - 1]!;
    assert(meta.version === lastPing.version, 'final metadata must match the last ping');
    assert(
      new Date(meta.captured_at).getTime() === new Date(tNewer).getTime(),
      'the newer capture must win the race'
    );
    assert(meta.branch_name === 'race/newer', 'metadata must carry the newer payload');
  });

  await test('Clean-tree snapshot (zero files) round-trips as the no-changes state', async () => {
    const res = await apiFetch(`/work-items/${workItemId}/git-state`, userAToken, {
      method: 'PUT',
      body: JSON.stringify(
        snapshotBody({ captured_at: new Date(Date.now() + 5000).toISOString() })
      ),
    });
    assert(res.ok, `clean PUT failed: ${res.status}`);
    const meta = (await (
      await apiFetch(`/work-items/${workItemId}/git-state`, userBToken)
    ).json()) as GitStateMeta;
    assert(meta.files.length === 0, 'clean snapshot must list zero files');
    const file = await apiFetch(
      `/work-items/${workItemId}/git-state/file?path=${encodeURIComponent('src/at-cap.ts')}`,
      userBToken
    );
    assert(file.status === 404, 'stale content rows must be gone after a clean push');
  });

  wsB?.close();
  printSummaryAndExit();
}

run().catch((err) => {
  console.error('Git-state probe runner failed:', err);
  process.exit(1);
});
