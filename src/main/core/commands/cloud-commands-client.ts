import { randomUUID } from 'node:crypto';
import {
  COMMAND_FETCH_MAX_WORK_ITEMS,
  type CloudCommand,
  type CommandFetchBody,
  type PermissionRequestPutBody,
  type PlanRequestPutBody,
} from '@chord/protocol';
import {
  cloudFetch,
  toSendResult,
  type SendResult,
} from '@main/core/work-items/cloud-work-items-client';
import { KV } from '@main/db/kv';

// Generated once per install and persisted — the claim protocol's identity
// ("two devices race, one wins" needs stable names, not a registry). Lives
// in KV, not app settings: it's infrastructure, never user-facing.
const deviceKV = new KV<{ deviceId: string }>('device');

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const stored = await deviceKV.get('deviceId');
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }
  const generated = randomUUID();
  await deviceKV.set('deviceId', generated);
  cachedDeviceId = generated;
  return generated;
}

/**
 * Pending commands for the given locally-present work items, ascending id,
 * plus rows this device already claimed but never acked (crash recovery).
 * Chunked to the server's per-request work-item cap; chunks re-merge in id
 * order so the caller's "execute ascending" contract holds across them.
 */
export async function fetchCommands(
  deviceId: string,
  workItemIds: string[]
): Promise<CloudCommand[]> {
  const results: CloudCommand[] = [];
  for (let i = 0; i < workItemIds.length; i += COMMAND_FETCH_MAX_WORK_ITEMS) {
    const body: CommandFetchBody = {
      device_id: deviceId,
      work_item_ids: workItemIds.slice(i, i + COMMAND_FETCH_MAX_WORK_ITEMS),
    };
    const res = await cloudFetch('/commands/fetch', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`commands fetch failed: ${res.status}`);
    results.push(...((await res.json()) as CloudCommand[]));
  }
  results.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return results;
}

/**
 * Atomic claim. Returns the claimed row, or null when the command is no
 * longer claimable (another device won the race, or it expired) — the
 * caller skips it; a 409 is an outcome here, not an error.
 */
export async function claimCommand(
  commandId: string,
  deviceId: string
): Promise<CloudCommand | null> {
  const res = await cloudFetch(`/commands/${commandId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (res.status === 409) return null;
  if (!res.ok) throw new Error(`command claim failed: ${res.status}`);
  return (await res.json()) as CloudCommand;
}

/**
 * Terminal ack. A 409 means the row already left 'claimed' under us (the
 * expiry sweep, or a prior ack whose response we lost) — the ledger already
 * guarantees no re-execution, so it's safe to treat as settled.
 */
export async function ackCommand(
  commandId: string,
  deviceId: string,
  status: 'acked' | 'failed',
  statusReason?: string
): Promise<void> {
  const res = await cloudFetch(`/commands/${commandId}/ack`, {
    method: 'POST',
    body: JSON.stringify({ device_id: deviceId, status, status_reason: statusReason }),
  });
  if (res.status === 409) return;
  if (!res.ok) throw new Error(`command ack failed: ${res.status}`);
}

/**
 * Creator-only PUT upsert for the outbound half of approvals (design §4):
 * publishes a permission request or retracts it (status resolved/expired).
 * Idempotent server-side — the sync-queue may replay a delivered PUT whose
 * response was lost. SendResult, not throw: this is a sync-queue send path
 * and rides its retry/backoff/404-requeue machinery.
 */
export async function pushCloudPermissionRequest(
  requestId: string,
  body: PermissionRequestPutBody
): Promise<SendResult> {
  const res = await cloudFetch(
    `/work-items/${body.work_item_id}/permission-requests/${requestId}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
  return toSendResult(res, false);
}

export async function pushCloudPlanRequest(
  requestId: string,
  body: PlanRequestPutBody
): Promise<SendResult> {
  const res = await cloudFetch(`/work-items/${body.work_item_id}/plan-requests/${requestId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return toSendResult(res, false);
}
