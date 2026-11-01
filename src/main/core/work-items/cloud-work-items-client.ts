import type {
  CloudGitStatePutBody,
  CloudSessionsPutBody,
  CloudWorktreesPutBody,
} from '@chord/protocol';
import {
  chordAccountService,
  type CachedProfile,
} from '@main/core/account/services/chord-account-service';
import { KV } from '@main/db/kv';

const REQUEST_TIMEOUT_MS = 10_000;

const accountKV = new KV<{ profile: CachedProfile }>('account');

// `terminal` (ARCH-3b, additive — every existing failure path leaves it
// undefined and is handled exactly as before) marks a failure the normal
// retry-with-backoff ladder must not run on: the operation already retried
// as much as it usefully could and the outcome is final. Currently only
// sendWorkItemUpdate's double-CAS-conflict case sets it.
export type SendResult =
  | { ok: true }
  | { ok: false; status: number; body: string; terminal?: boolean };

// Queue payloads are stored in WIRE SHAPE (snake_case) at the enqueue
// boundary: the queue spread-merges an update into a pending create, and
// mixed-casing payloads would silently drop fields at send time. Only these
// named mappers translate from local camelCase rows.
export interface CloudWorkItemCreateBody {
  id: string;
  name: string;
  status: string;
  repo_name?: string;
  /** The repo's normalized origin (`@shared/repo-remote-url`); a teammate's sidebar matches on it. */
  repo_remote_url?: string;
  branch_name?: string;
  agent_provider?: string;
  /** Who has access from the start — the You › Sharing default (P6). */
  general_access: 'invited' | 'team';
  general_role: 'view' | 'edit';
}

/** You › Sharing "default access for new work items". */
export type DefaultWorkItemAccess = 'invited' | 'team_view';

export interface CloudWorkItemPatchBody {
  name?: string;
  status?: string;
  workflow_phase?: string;
  repo_name?: string;
  repo_remote_url?: string;
  branch_name?: string;
  pr_number?: number | null;
  pr_url?: string | null;
  // Optimistic-concurrency precondition (ARCH-3b) — set at send time from the
  // local row's cloudVersion, NOT stored in the queued payload (see
  // sync-queue-service.ts's sendWorkItemUpdate), so a retry always carries
  // whatever the freshest known version is instead of a stale one baked in
  // at enqueue time.
  expected_version?: number;
}

export function toCloudWorkItemCreateBody(
  item: {
    id: string;
    name: string;
    status: string;
    repoAlias: string | null;
    /** Normalized, read off the repo's origin by the caller (`readRepoOrigin`). */
    repoRemoteUrl: string | null;
    branchName: string | null;
    agentProvider: string | null;
  },
  defaultAccess: DefaultWorkItemAccess
): CloudWorkItemCreateBody {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    repo_name: item.repoAlias ?? undefined,
    repo_remote_url: item.repoRemoteUrl ?? undefined,
    branch_name: item.branchName ?? undefined,
    agent_provider: item.agentProvider ?? undefined,
    general_access: defaultAccess === 'team_view' ? 'team' : 'invited',
    general_role: 'view',
  };
}

export function toCloudWorkItemPatchBody(updates: {
  name?: string;
  status?: string;
  branchName?: string;
  prNumber?: number | null;
  prUrl?: string | null;
  repoAlias?: string;
}): CloudWorkItemPatchBody {
  const body: CloudWorkItemPatchBody = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.status !== undefined) body.status = updates.status;
  if (updates.branchName !== undefined) body.branch_name = updates.branchName;
  if (updates.prNumber !== undefined) body.pr_number = updates.prNumber;
  if (updates.prUrl !== undefined) body.pr_url = updates.prUrl;
  if (updates.repoAlias !== undefined) body.repo_name = updates.repoAlias;
  return body;
}

export function cloudApiBase(): string {
  const base = process.env.CHORD_CLOUD_API_URL?.trim();
  if (!base) throw new Error('CHORD_CLOUD_API_URL is not configured');
  return base;
}

/** `timeoutMs` is for the few requests that carry large bodies (a page view is up to 8 MiB). */
export async function cloudFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const token = await chordAccountService.getAccessToken();
  if (!token) throw new Error('Not signed in');

  return fetch(`${cloudApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function toSendResult(
  res: Response,
  treatMissingAsSuccess: boolean
): Promise<SendResult> {
  if (res.ok) return { ok: true };
  if (treatMissingAsSuccess && res.status === 404) return { ok: true };
  const body = await res.text();
  return { ok: false, status: res.status, body };
}

/**
 * Posts the local profile to the cloud so an org is provisioned, then returns
 * the resolved org id. Returns null ONLY on an authoritative no-org answer
 * (no cloud account, or the server responded 200 with org_id null). Any
 * failed response throws — like a network failure — so the caller defers the
 * sync cycle without consuming a per-operation retry; a 5xx here previously
 * read as "no org" and silently wedged the whole queue (NEW-6). The org
 * display name is server-resolved; the body carries identity fields only.
 */
export async function resolveOrgId(): Promise<string | null> {
  const profile = await accountKV.get('profile');
  if (!profile?.hasAccount) return null;
  if (profile.orgId) return profile.orgId;

  const res = await cloudFetch('/auth/sync-profile', {
    method: 'POST',
    body: JSON.stringify({
      name: profile.username,
      avatar_url: profile.avatarUrl,
    }),
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`sync-profile failed: HTTP ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { org_id?: string | null };
  if (!data.org_id) return null;

  profile.orgId = data.org_id;
  await accountKV.set('profile', profile);
  return data.org_id;
}

export interface CloudWorkItemRow {
  id: string;
  repo_name: string | null;
  repo_remote_url: string | null;
  branch_name: string | null;
  /** 'team' = every member of the item's team can open it (P6). */
  general_access: 'invited' | 'team';
}

export async function fetchCloudWorkItems(): Promise<CloudWorkItemRow[]> {
  const res = await cloudFetch('/work-items');
  if (!res.ok) throw new Error(`Failed to fetch cloud work items: ${res.status}`);
  return (await res.json()) as CloudWorkItemRow[];
}

export interface WorkItemMemberSummary {
  work_item_id: string;
  has_members: boolean;
}

/**
 * Every one of the caller's own work items that has an active member, in one
 * request (GET /work-items/member-summary) instead of one per item — the
 * shared-set refresh runs every 60s for every owner.
 */
export async function fetchCloudWorkItemMemberSummary(): Promise<WorkItemMemberSummary[]> {
  const res = await cloudFetch('/work-items/member-summary');
  if (!res.ok) throw new Error(`Failed to fetch member summary: ${res.status}`);
  return (await res.json()) as WorkItemMemberSummary[];
}

// Success carries the accepted row's version_number so the queue can stamp
// the local row as synced (cloud_id, synced_at, cloud_version) — 201 for a
// fresh insert, 200 when the server already held the caller's own id (its
// idempotent retry path). A 409 is the one non-retryable answer: the id
// belongs to ANOTHER creator (routes/work-items.ts), which no backoff ladder
// can change — so it is terminal, failing the row on the first answer.
export type CloudWorkItemCreateResult =
  | { ok: true; version_number: number }
  | { ok: false; status: number; body: string; terminal?: boolean };

export async function createCloudWorkItem(
  orgId: string,
  body: CloudWorkItemCreateBody
): Promise<CloudWorkItemCreateResult> {
  const res = await cloudFetch('/work-items', {
    method: 'POST',
    body: JSON.stringify({ ...body, org_id: orgId }),
  });
  if (res.ok) {
    const row = (await res.json()) as { version_number: number };
    return { ok: true, version_number: row.version_number };
  }
  const bodyText = await res.text();
  if (res.status === 409) {
    return { ok: false, status: 409, body: `HTTP 409: ${bodyText}`, terminal: true };
  }
  return { ok: false, status: res.status, body: bodyText };
}

// Richer than SendResult on purpose: the CAS retry in sync-queue-service.ts
// needs the accepted version_number on success (to stamp WorkItemRow.
// cloudVersion) and the server's current version_number on a 409 (to retry
// once with a fresh expected_version) — plain {ok, status, body} can't carry
// either.
export type CloudWorkItemUpdateResult =
  | { ok: true; version_number: number }
  | { ok: false; status: number; body: string; currentVersion?: number };

export async function updateCloudWorkItem(
  id: string,
  body: CloudWorkItemPatchBody
): Promise<CloudWorkItemUpdateResult> {
  const res = await cloudFetch(`/work-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const updated = (await res.json()) as { version_number: number };
    return { ok: true, version_number: updated.version_number };
  }

  if (res.status === 409) {
    // Body is {error, current} (see routes/work-items.ts's PATCH CAS 409) —
    // tolerate a malformed/empty body rather than throw, since this is
    // already the error path.
    const conflict = (await res.json().catch(() => null)) as {
      current?: { version_number: number };
    } | null;
    return {
      ok: false,
      status: 409,
      body: 'Version conflict',
      currentVersion: conflict?.current?.version_number,
    };
  }

  const text = await res.text();
  return { ok: false, status: res.status, body: text };
}

export async function deleteCloudWorkItem(id: string): Promise<SendResult> {
  const res = await cloudFetch(`/work-items/${id}`, { method: 'DELETE' });
  return toSendResult(res, true);
}

export async function pushCloudGitState(
  id: string,
  body: CloudGitStatePutBody
): Promise<SendResult> {
  const res = await cloudFetch(`/work-items/${id}/git-state`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return toSendResult(res, false);
}

/**
 * Bulk-replace push for T0.8 (cloud sync of worktree metadata): `body`
 * carries the item's FULL current worktree list, so a 200 always means the
 * cloud now mirrors exactly what was sent — no client-side merge needed.
 * `treatMissingAsSuccess: false` so a 404 (parent work item not on the cloud
 * yet) surfaces to the caller as a failure — sync-queue-service.ts's
 * WORK_ITEM_CHILD_ENTITIES requeue policy is what handles that case.
 */
export async function pushCloudWorktrees(
  id: string,
  body: CloudWorktreesPutBody
): Promise<SendResult> {
  const res = await cloudFetch(`/work-items/${id}/worktrees`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return toSendResult(res, false);
}

/**
 * Bulk-replace push for the cloud session registry (devstation-uka): `body`
 * carries the item's FULL current chat-session list, so a 200 always means
 * the cloud now mirrors exactly what was sent. `treatMissingAsSuccess: false`
 * for the same reason as worktrees — a 404 means the parent work item has not
 * reached the cloud yet, which is the WORK_ITEM_CHILD_ENTITIES requeue
 * policy's job, not a success.
 */
export async function pushCloudSessions(
  id: string,
  body: CloudSessionsPutBody
): Promise<SendResult> {
  const res = await cloudFetch(`/work-items/${id}/sessions`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return toSendResult(res, false);
}
