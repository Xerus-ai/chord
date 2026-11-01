import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Accounts, teams, work items and what their owners publish: chat, commands,
 * agent requests, git state, worktrees and sessions.
 *
 * One of the server schema modules (schema*.ts): db/client.ts merges them,
 * and drizzle-kit reads them all.
 */

// ─── Users (synced from WorkOS) ─────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatar_url: text('avatar_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Organizations (synced from WorkOS) ─────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  // Team billing. Every org starts on the free plan with 5 seats; a Polar
  // subscription upgrades plan/seat_limit via webhook. seat_limit is the
  // enforced ceiling for members + pending invites — it lives here rather
  // than being derived from `plan` so a custom-plan org can get a bespoke
  // limit without a schema change.
  plan: text('plan').notNull().default('free'),
  seat_limit: integer('seat_limit').notNull().default(5),
  polar_customer_id: text('polar_customer_id'),
  polar_subscription_id: text('polar_subscription_id'),
  subscription_status: text('subscription_status'),
  current_period_end: timestamp('current_period_end', { withTimezone: true }),
  billing_email: text('billing_email'),
  // Team sharing policy (P6), owner-controlled in Workspace › Team. Off hides
  // the "Anyone with the link" option and stops every existing public link;
  // off also stops publishing artifacts to Confluence.
  allow_public_links: boolean('allow_public_links').notNull().default(true),
  allow_confluence_publishing: boolean('allow_confluence_publishing').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Organization Memberships ────────────────────────────────────────────────

export const orgMemberships = pgTable(
  'org_memberships',
  {
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    org_id: text('org_id')
      .notNull()
      .references(() => organizations.id),
    role: text('role').notNull().default('member'),
  },
  (table) => [
    primaryKey({ columns: [table.user_id, table.org_id] }),
    // Single-owner invariant: an org has at most one `owner`. Partial so the
    // many `member` rows are unconstrained. Backfilled + created in
    // 0011_owner_role_and_single_owner_index.sql.
    uniqueIndex('uq_org_memberships_single_owner')
      .on(table.org_id)
      .where(sql`${table.role} = 'owner'`),
  ]
);

// ─── Work Items ──────────────────────────────────────────────────────────────

export const workItems = pgTable(
  'work_items',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id')
      .notNull()
      .references(() => organizations.id),
    creator_id: text('creator_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    workflow_phase: text('workflow_phase').default('build'),
    ticket_id: text('ticket_id'),
    ticket_provider: text('ticket_provider'),
    ticket_url: text('ticket_url'),
    pr_number: integer('pr_number'),
    pr_url: text('pr_url'),
    repo_name: text('repo_name'),
    // The repo's normalized origin (`github.com/acme/chord`), which a
    // teammate's app matches against its own repos; repo_name is the owner's
    // local alias. Null until the owner's app sends it (migration 0022).
    repo_remote_url: text('repo_remote_url'),
    branch_name: text('branch_name'),
    agent_provider: text('agent_provider'),
    // General access (P6): 'invited' (only members and the author) or 'team'
    // (every member of org_id at general_role). A work item is never public.
    general_access: text('general_access').notNull().default('invited'),
    general_role: text('general_role').notNull().default('view'),
    // Who may answer agent permission requests via permission_response
    // commands: 'owner' (default) or 'participants' (per-item opt-in). Gates
    // command INSERTS on top of the write tier — see routes/commands.ts.
    approval_policy: text('approval_policy').notNull().default('owner'),
    // Whether ambient room chat wakes the agent: 'manual' (only explicit
    // prompt commands, the only v1 behavior) or 'semi_live' (reserved —
    // ambient messages auto-relayed into the agent; named now so it can later
    // ride the same rails without schema rework).
    delivery_policy: text('delivery_policy').notNull().default('manual'),
    // Monotonic, server-assigned: bumped on every mutation and carried on the
    // work_item_updated broadcast so clients can drop stale/out-of-order events
    // instead of clobbering newer state.
    version_number: integer('version_number').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Serves every creator-scoped read — GET /, /member-summary and
    // /participant-rosters all filter on creator_id.
    index('idx_work_items_creator').on(table.creator_id),
  ]
);

// ─── Chat Messages ───────────────────────────────────────────────────────────

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    // The local agent_sessions.id that produced this message (that table is
    // client-side only, schema-work-items.ts — no cloud mirror or sync path
    // exists yet, that's a separate command-channel-project effort). Nullable
    // and intentionally NOT FK-constrained: the referenced session may never
    // reach the cloud, and an insert must not fail waiting on it. Null for
    // messages with no session (participant WS chat, single REST posts).
    // Capturing this now means the data already exists once a cloud
    // agent_sessions table (and a real FK) lands.
    session_id: text('session_id'),
    sender_id: text('sender_id').references(() => users.id),
    sender_type: text('sender_type').notNull(),
    sender_name: text('sender_name'),
    content: text('content').notNull(),
    message_type: text('message_type').notNull().default('text'),
    metadata: jsonb('metadata').default({}),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The id column serves the keyset cursor's (created_at, id) row comparison.
    index('idx_messages_work_item').on(table.work_item_id, table.created_at, table.id),
    index('idx_messages_session').on(table.session_id),
  ]
);

// ─── Commands (the command-channel inbox) ────────────────────────────────────

// Durable cloud inbox drained down to the owner's device — the sync-queue
// outbox pattern pointed the other way (design:
// the command channel design). WS is only the doorbell;
// the device fetches, claims (atomic UPDATE … WHERE status='pending'), and
// acks over REST. id is uuidv7 (lib/uuidv7.ts): sortable, so ascending-id
// fetch/execute preserves per-work-item issue order. session_id is the
// OPAQUE local agent_sessions.id — no FK until a cloud registry lands (same
// deliberate gap as chat_messages.session_id above). payload is per-kind,
// zod-validated at insert (routes/commands.ts).
export const commands = pgTable(
  'commands',
  {
    id: text('id').primaryKey(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    session_id: text('session_id'),
    issuer_id: text('issuer_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(), // 'prompt' | 'interrupt' | 'permission_response'
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'), // 'pending'|'claimed'|'acked'|'failed'|'expired'
    status_reason: text('status_reason'),
    claimed_by_device: text('claimed_by_device'),
    claimed_at: timestamp('claimed_at', { withTimezone: true }),
    acked_at: timestamp('acked_at', { withTimezone: true }),
    // NULL never expires server-side ('prompt' parks until the agent runs).
    // Stamped at insert: interrupt +10min, permission_response inherits its
    // permission request's expires_at.
    expires_at: timestamp('expires_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The device fetch is "pending commands for these work items, ascending id".
  (table) => [index('idx_commands_work_item_status').on(table.work_item_id, table.status, table.id)]
);

// ─── Agent Permission Requests (outbound half of remote approvals) ──────────

// Published by the owner's device via the sync-queue when the agent asks for
// tool permission; resolved either locally (owner clicked) or by a
// permission_response command. request_id is the SDK's requestId — the
// device is the id authority here, so it's the natural PK. resolved_by NULL
// = resolved locally by the owner app, not by a cloud user.
export const agentPermissionRequests = pgTable(
  'agent_permission_requests',
  {
    request_id: text('request_id').primaryKey(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    session_id: text('session_id'),
    tool_name: text('tool_name').notNull(),
    input: jsonb('input').notNull(),
    // The AcpPermissionOption list the participant UI renders.
    options: jsonb('options').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'resolved' | 'expired'
    resolved_by: text('resolved_by').references(() => users.id),
    resolution: text('resolution'), // 'allow_once' | 'allow_always' | 'reject_once' | 'expired'
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(), // created_at + 24h
  },
  (table) => [index('idx_permission_requests_work_item').on(table.work_item_id, table.status)]
);

// ─── Agent Plan Requests (outbound half of remote plan approvals) ───────────

// Published by the owner's device via the sync-queue when the agent proposes a
// plan; resolved either locally (owner clicked) or by a plan_response command.
// Plans carry approve/reject only (no multi-option list). request_id is the
// SDK's requestId — the device is the id authority, so it's the natural PK.
// resolved_by NULL = resolved locally by the owner app, not by a cloud user.
export const agentPlanRequests = pgTable(
  'agent_plan_requests',
  {
    request_id: text('request_id').primaryKey(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    session_id: text('session_id'),
    title: text('title').notNull(),
    overview: text('overview').notNull(),
    steps: jsonb('steps').notNull(), // Array<{ text: string; completed: boolean }>
    status: text('status').notNull().default('pending'), // 'pending' | 'resolved' | 'expired'
    resolved_by: text('resolved_by').references(() => users.id),
    resolution: text('resolution'), // 'approve' | 'reject' | 'expired'
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(), // created_at + 24h
  },
  (table) => [index('idx_plan_requests_work_item').on(table.work_item_id, table.status)]
);

// ─── Work Item Git State (latest owner-pushed snapshot) ─────────────────────

// Single latest-snapshot row per work item — no history table by design (no
// consumer; history would belong in blob storage). version mirrors
// work_items.version_number: integer, NOT bigint (pg bigint serializes to a
// JS string and breaks numeric guards); incremented in-SQL by the PUT upsert.
// captured_at is the owner's capture time — staleness display plus
// out-of-order rejection when two owner windows race. files holds metadata
// ONLY: [{path, status, additions, deletions, content_omitted}].
export const workItemGitState = pgTable('work_item_git_state', {
  work_item_id: text('work_item_id')
    .primaryKey()
    .references(() => workItems.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  captured_at: timestamp('captured_at', { withTimezone: true }).notNull(),
  branch_name: text('branch_name'),
  files: jsonb('files').notNull().default([]),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Full pre/post-images as TEXT, not jsonb — opaque blobs, never queried by
// content, fetched one at a time by PK. An added file has empty original; a
// deleted file has empty modified.
export const workItemGitFiles = pgTable(
  'work_item_git_files',
  {
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    original: text('original').notNull(),
    modified: text('modified').notNull(),
    // Fingerprint of (original, modified) — see computeContentHash in
    // routes/git-state.ts. Lets a push skip re-uploading a file whose
    // content is already stored here unchanged. Default '' for pre-existing
    // rows: never equals a real hash, so they're just treated as changed
    // (re-uploaded once), which is the safe direction.
    content_hash: text('content_hash').notNull().default(''),
  },
  (table) => [primaryKey({ columns: [table.work_item_id, table.path] })]
);

// Worktree METADATA only (T0.8, D2) — branch, base branch, title, primary
// flag, status bucket, diff counts, archive state. No file contents, no
// per-worktree git state: workItemGitState above stays keyed by work_item_id
// (primary worktree only). Bulk-replaced by PUT /work-items/:id/worktrees —
// the owner's full local worktree list for the item, upserted, with any row
// not listed deleted.
export const workItemWorktrees = pgTable(
  'work_item_worktrees',
  {
    id: text('id').primaryKey(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    branch_name: text('branch_name'),
    base_branch: text('base_branch'),
    title: text('title'),
    is_primary: boolean('is_primary').notNull().default(false),
    status_bucket: text('status_bucket').notNull().default('idle'),
    additions: integer('additions').notNull().default(0),
    deletions: integer('deletions').notNull().default(0),
    // false when the client's local diff stats were unavailable — additions/
    // deletions are then a placeholder 0, not a real "no changes" answer.
    diff_known: boolean('diff_known').notNull().default(false),
    archived_at: timestamp('archived_at', { withTimezone: true }),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_work_item_worktrees_work_item').on(table.work_item_id)]
);

/**
 * Registry of a shared work item's agent CHAT threads, published by the
 * owner's device (PUT /work-items/:id/sessions). It exists so a participant's
 * client can render one tab per thread and address a message to a specific
 * one — before it, `agent_sessions` never left the owner's SQLite and every
 * participant message was stored with `session_id = null`.
 *
 * Shell-terminal sessions are never published; see packages/protocol's
 * sessions.ts for the full list of local columns held back and why.
 */
export const workItemSessions = pgTable(
  'work_item_sessions',
  {
    id: text('id').primaryKey(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    agent_provider_id: text('agent_provider_id'),
    title: text('title'),
    status: text('status').notNull().default('active'),
    // Intentionally NOT a foreign key to work_item_worktrees: that table is
    // maintained by its own whole-set replace, and a trimmed worktree row
    // must not cascade a live conversation out of existence.
    worktree_id: text('worktree_id'),
    last_active_at: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // As the owner's composer names them; a teammate's composer shows them.
    model_label: text('model_label'),
    permission_mode_label: text('permission_mode_label'),
  },
  (table) => [index('idx_work_item_sessions_work_item').on(table.work_item_id)]
);
