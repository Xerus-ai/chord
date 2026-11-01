import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { artifactComments, artifacts } from './schema-artifacts.js';
import { organizations, users, workItems } from './schema.js';

/**
 * Who is where and who may see what: presence, notifications, members, share
 * links, the access audit, and team invites.
 *
 * One of the server schema modules (schema*.ts): db/client.ts merges them,
 * and drizzle-kit reads them all.
 */

// ─── Presence ────────────────────────────────────────────────────────────────

// Keyed by (user_id, work_item_id) so one user's windows on different work
// items hold separate rows instead of collapsing into one. work_item_id NULL
// is the "online, not scoped to a work item" row (written on WS connect).
// Two partial unique indexes instead of UNIQUE NULLS NOT DISTINCT: the pinned
// drizzle-kit cannot introspect nulls-not-distinct constraints, which would
// make every future `drizzle-kit push` try to re-add the constraint and fail.
export const presence = pgTable(
  'presence',
  {
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    work_item_id: text('work_item_id').references(() => workItems.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('online'),
    cursor_position: jsonb('cursor_position'),
    active_view: text('active_view'),
    last_seen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_presence_user_work_item')
      .on(table.user_id, table.work_item_id)
      .where(sql`${table.work_item_id} is not null`),
    uniqueIndex('uq_presence_user_no_work_item')
      .on(table.user_id)
      .where(sql`${table.work_item_id} is null`),
    index('idx_presence_work_item').on(table.work_item_id),
  ]
);

// ─── Notifications ───────────────────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    // NotificationTypeSchema (@chord/protocol), checked in code.
    type: text('type').notNull(),
    // The facts the app builds the sentence from (0020; 0021 dropped the old
    // title/body sentences). actor_user_id is NULL once the actor's account
    // is deleted.
    actor_user_id: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    // The team a team_invite is for.
    org_id: text('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    // SET NULL, not cascade: notifications are user-owned history; a deleted
    // work item nulls the pointer and the client's 404 fallback covers clicks.
    work_item_id: text('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    // Set for "shared an artifact with you": the recipient may have access to
    // the artifact alone, so the notification opens it rather than the item.
    artifact_id: text('artifact_id').references(() => artifacts.id, { onDelete: 'set null' }),
    comment_id: text('comment_id').references(() => artifactComments.id, { onDelete: 'set null' }),
    // Chat messages are not in Postgres, so no foreign key.
    message_id: text('message_id'),
    // At most 200 characters (ck_notifications_excerpt_length).
    excerpt: text('excerpt'),
    read: boolean('read').default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_notifications_user').on(table.user_id, table.read, table.created_at),
    index('idx_notifications_work_item').on(table.work_item_id),
    index('idx_notifications_actor')
      .on(table.actor_user_id)
      .where(sql`${table.actor_user_id} is not null`),
    index('idx_notifications_org')
      .on(table.org_id)
      .where(sql`${table.org_id} is not null`),
    index('idx_notifications_comment')
      .on(table.comment_id)
      .where(sql`${table.comment_id} is not null`),
    index('idx_notifications_read_created')
      .on(table.created_at)
      .where(sql`${table.read} = true`),
  ]
);

// ─── Resource Members (P6 sharing) ───────────────────────────────────────────

// One member table for work items and artifacts. artifact_id NULL = a member
// of the work item (and so, by inheritance, of every artifact in it); set = a
// member of that artifact alone, which never reaches the work item's chat,
// agent, git state or messages. Exactly one of user_id / invited_email: an
// invited_email row is pending until that person joins the work item's team
// (access/activate-pending-members.ts). The author is work_items.creator_id
// and never has a row. Created in 0016_resource_access.sql.
export const resourceMembers = pgTable(
  'resource_members',
  {
    id: text('id').primaryKey(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    artifact_id: text('artifact_id'),
    user_id: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    invited_email: text('invited_email'),
    role: text('role').notNull(),
    granted_by: text('granted_by')
      .notNull()
      .references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_resource_members_artifact',
      columns: [table.artifact_id, table.work_item_id],
      foreignColumns: [artifacts.id, artifacts.work_item_id],
    }).onDelete('cascade'),
    uniqueIndex('uq_resource_members_work_item_user')
      .on(table.work_item_id, table.user_id)
      .where(sql`${table.artifact_id} is null and ${table.user_id} is not null`),
    uniqueIndex('uq_resource_members_artifact_user')
      .on(table.artifact_id, table.user_id)
      .where(sql`${table.artifact_id} is not null and ${table.user_id} is not null`),
    index('idx_resource_members_user').on(table.user_id),
  ]
);

// ─── Share Links (public artifact links) ─────────────────────────────────────

// "Anyone with the link" for an artifact. The token is never stored: it is
// HMAC(SHARE_LINK_SECRET, id), so the author can copy it again, and only its
// sha256 is kept for lookup (access/share-link-tokens.ts). One live link per
// artifact (partial unique index in 0016).
export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    artifact_id: text('artifact_id').notNull(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    token_hash: text('token_hash').notNull().unique(),
    comments_enabled: boolean('comments_enabled').notNull().default(true),
    created_by: text('created_by')
      .notNull()
      .references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'fk_share_links_artifact',
      columns: [table.artifact_id, table.work_item_id],
      foreignColumns: [artifacts.id, artifacts.work_item_id],
    }).onDelete('cascade'),
  ]
);

// ─── Access Events (audit) ───────────────────────────────────────────────────

// One row per grant, revoke, role or general-access change, link change and
// public link open. No foreign keys: the trail outlives what it describes.
export const accessEvents = pgTable(
  'access_events',
  {
    id: text('id').primaryKey(),
    work_item_id: text('work_item_id').notNull(),
    artifact_id: text('artifact_id'),
    actor_id: text('actor_id'),
    subject_user_id: text('subject_user_id'),
    subject_email: text('subject_email'),
    action: text('action').notNull(),
    role: text('role'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_access_events_work_item').on(table.work_item_id, table.created_at),
    index('idx_access_events_artifact').on(table.artifact_id, table.created_at),
  ]
);

// ─── Team Invites ────────────────────────────────────────────────────────────

export const teamInvites = pgTable(
  'team_invites',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id')
      .notNull()
      .references(() => organizations.id),
    inviter_id: text('inviter_id')
      .notNull()
      .references(() => users.id),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('pending'),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    accepted_at: timestamp('accepted_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_invites_email').on(table.email, table.status)]
);
