import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  notificationType: text('notification_type').notNull(),
  inApp: integer('in_app').notNull().default(1),
  desktop: integer('desktop').notNull().default(1),
  sound: integer('sound').notNull().default(0),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
export type NotificationPreferenceInsert = typeof notificationPreferences.$inferInsert;

export const syncQueue = sqliteTable(
  'sync_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operation: text('operation').notNull(),
    entityType: text('entity_type').notNull().default('work_item'),
    entityId: text('entity_id').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull().default('pending'),
    retryCount: integer('retry_count').notNull().default(0),
    errorMessage: text('error_message'),
    lastAttemptedAt: integer('last_attempted_at'),
    // Wall-clock start of an ongoing "parent work item missing" 404 requeue
    // streak (WORK_ITEM_CHILD_ENTITIES only). Null when the row has never
    // orphan-requeued, or once it has been revived. Bounds that loop by time
    // instead of retryCount, since these requeues deliberately don't consume
    // a retry — see sync-queue-service.ts processRow.
    firstOrphanedAt: integer('first_orphaned_at'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    statusIdx: index('idx_sync_queue_status').on(table.status, table.createdAt),
    entityIdx: index('idx_sync_queue_entity').on(table.entityId),
  })
);

export type SyncQueueRow = typeof syncQueue.$inferSelect;
export type SyncQueueInsert = typeof syncQueue.$inferInsert;

// The command channel's local dedup ledger — the inverse of sync_queue: that
// table makes local→cloud pushes durable, this one makes cloud→local command
// delivery SAFE. Delivery is at-least-once (a crash between claim and ack
// recovers by redelivery), so before executing a command the inbox inserts
// its ledger row; a command already 'executed' here is re-acked to the
// cloud, never re-executed. 'parked' is a prompt waiting for a chat session
// to start (flushed in id order when one does). See
// the command channel design §3 and
// core/commands/command-inbox-service.ts.
export const commandLedger = sqliteTable(
  'command_ledger',
  {
    commandId: text('command_id').primaryKey(),
    workItemId: text('work_item_id').notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull(), // 'parked' | 'executed'
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    executedAt: integer('executed_at'),
  },
  (table) => ({
    workItemIdx: index('idx_command_ledger_work_item').on(table.workItemId, table.state),
  })
);

export type CommandLedgerRow = typeof commandLedger.$inferSelect;
export type CommandLedgerInsert = typeof commandLedger.$inferInsert;

// The owner-side ledger of agent permission requests this device has
// PUBLISHED to the cloud (sync-queue entity 'permission_request', design §4)
// and therefore owes a retraction for. A row is 'pending' from the
// publication tap (agent-event-bridge) until a local resolution — owner
// click or teammate command via the respondToPermission fan — or the owning
// session ending flips it. Persisted, not in-memory, for exactly one reason:
// sessions never survive an app restart, so startup reconciliation
// (permission-publication-service.reconcileOnStartup) expires every row
// still 'pending' and enqueues the retraction — otherwise a crash would
// leave cloud cards with live Allow buttons for the full 24h server expiry.
export const publishedPermissionRequests = sqliteTable(
  'published_permission_requests',
  {
    requestId: text('request_id').primaryKey(),
    workItemId: text('work_item_id').notNull(),
    sessionId: text('session_id'),
    // JSON AcpPermissionOption[] — kept locally because a permission_response
    // command names its choice by option KIND ('allow_once'…, the wire enum)
    // while ACP agents use arbitrary optionIds; the inbox executor maps kind
    // back to the agent's real optionId through this list.
    options: text('options').notNull(),
    status: text('status').notNull(), // 'pending' | 'resolved' | 'expired'
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    resolvedAt: integer('resolved_at'),
  },
  (table) => ({
    sessionIdx: index('idx_published_permissions_session').on(table.sessionId, table.status),
  })
);

export type PublishedPermissionRequestRow = typeof publishedPermissionRequests.$inferSelect;

export const publishedPlanRequests = sqliteTable(
  'published_plan_requests',
  {
    requestId: text('request_id').primaryKey(),
    workItemId: text('work_item_id').notNull(),
    sessionId: text('session_id'),
    title: text('title').notNull(),
    overview: text('overview').notNull(),
    steps: text('steps').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    resolvedAt: integer('resolved_at'),
  },
  (table) => ({
    sessionIdx: index('idx_published_plans_session').on(table.sessionId, table.status),
  })
);

export type PublishedPlanRequestRow = typeof publishedPlanRequests.$inferSelect;

// Per-thread cursor — the newest local chat_messages ROWID already delivered
// into (or superseded at) one agent session. The digest builder
// (core/chat-messages/thread-digest.ts) prepends that thread's messages with
// rowid > last_rowid to every prompt entering the session, then advances this.
// Keyed by session, not work item: the Room's single work-item cursor meant
// whichever agent prompted first consumed the digest and a second agent in the
// same work item never saw those messages at all.
// ROWID (local arrival order), not created_at: ingested cloud rows can carry
// old timestamps but are still unseen — "arrived after the agent's last
// turn" is the honest definition of unseen. Design doc §4.
export const agentThreadCursors = sqliteTable('agent_thread_cursors', {
  sessionId: text('session_id').primaryKey(),
  lastRowid: integer('last_rowid').notNull(),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export type AgentThreadCursorRow = typeof agentThreadCursors.$inferSelect;
