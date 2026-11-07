import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const repos = sqliteTable('repos', {
  id: text('id').primaryKey(),
  path: text('path').notNull().unique(),
  alias: text('alias').notNull(),
  addedAt: integer('added_at')
    .notNull()
    .default(sql`(unixepoch())`),
  // Archiving hides a repo from the create-work-item pickers without deleting
  // the row. The row is what `work_items.repo_id` resolves against — including
  // the repo-level trust decision — so its work items keep working untouched.
  // Hard deletion is reserved for repos no work item references at all.
  archivedAt: integer('archived_at'),
  // One of `REPO_ICON_KEYS` (src/shared/repo-icons.ts), or NULL for "no icon
  // chosen" — which is the default and renders the coloured letter tile. A
  // stable key rather than a lucide component name, so the component behind it
  // can change without a data migration; validated on write by repos.setIcon
  // and again on read, because a key this build no longer ships must degrade
  // to the letter tile rather than reach the component map.
  icon: text('icon'),
});

export const workItems = sqliteTable(
  'work_items',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    prNumber: integer('pr_number'),
    prUrl: text('pr_url'),
    repoId: text('repo_id').references(() => repos.id, { onDelete: 'set null' }),
    repoPath: text('repo_path').notNull(),
    repoAlias: text('repo_alias'),
    branchName: text('branch_name'),
    // Worktree acquisition lifecycle: 'provisioning' | 'ready' | 'failed'.
    // While not 'ready', repoPath still holds the shared repo root, so agent
    // execution (chat and terminal) is refused — that gate is what preserves
    // the isolation invariant now that row creation no longer waits for the
    // worktree. Existing rows default to 'ready': they were created under the
    // old blocking flow and always have a real worktree path.
    provisionStatus: text('provision_status').notNull().default('ready'),
    provisionError: text('provision_error'),
    effort: text('effort').default('high'),
    model: text('model'),
    agentProvider: text('agent_provider'),
    sharedWith: text('shared_with').default('[]'),
    sharingLevel: text('sharing_level').default('private'),
    cloudId: text('cloud_id'),
    syncedAt: integer('synced_at'),
    // The Chord account this row belongs to — the one sync acts for. Local
    // data outlives sign-out, so one profile can hold items of several
    // accounts; without this, a sign-in as B re-uploaded A's items under B
    // (devstation-as2). Values: the creating account's user id, stamped at
    // creation; NULL for rows created before this column (or while signed
    // out) — attributed to the first account that reconciles them, which the
    // server then confirms (200/201) or corrects; or OWNED_BY_ANOTHER_ACCOUNT
    // (work-item-account-ownership.ts) once the server answered that the id
    // belongs to a different creator (409). An item marked that way is not
    // synced and not a failure; it is re-attributed the moment it shows up
    // in the signed-in account's own cloud listing.
    ownerAccountId: text('owner_account_id'),
    // Cloud work_items.version_number as of the last PATCH response or GET
    // this client saw — the CAS precondition the sync-queue PATCH sends as
    // expected_version (ARCH-3b). Null until the first successful cloud
    // create/update/fetch for this row; a null expected_version falls back to
    // the server's old blind-write behavior, so this is safe to roll out
    // gradually.
    cloudVersion: integer('cloud_version'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    statusIdx: index('idx_work_items_status').on(table.status),
  })
);

export const workItemWorktrees = sqliteTable(
  'work_item_worktrees',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    // Not unique: existing installs have pre-worktree work items that share the same
    // repo_path (the repo root), and the 0033 backfill inserts one row per
    // work item, so a UNIQUE constraint here would reject the backfill.
    path: text('path').notNull(),
    branchName: text('branch_name'),
    baseBranch: text('base_branch'),
    isPrimary: integer('is_primary').notNull().default(0),
    title: text('title'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    archivedAt: integer('archived_at'),
    // Outcome of the last commit/push attempted against this worktree
    // (commit-and-push.ts). Null means either nothing has run yet or the
    // last attempt succeeded — cleared by the next success, set to the
    // thrown error's message by a failure. Read by sidebar-worktree-
    // summaries.ts as the `gitOperationFailed` bucket signal.
    gitLastError: text('git_last_error'),
    gitLastErrorAt: integer('git_last_error_at'),
    // Lane identity (plan 2026-09-26). Null on rows created before lanes:
    // those keep working, they just have no recorded fork point or PR target.
    // `target_ref` is where the lane's PR merges (e.g. `origin/main`) and the
    // ref `.chord.json` is read at; `fork_sha` is the commit the branch
    // started from and never changes; `slug` names the checkout directory so
    // a branch rename never moves the cwd.
    targetRef: text('target_ref'),
    forkSha: text('fork_sha'),
    slug: text('slug'),
    // 'chord' when Chord named the branch, 'user' when the user supplied it.
    // Only chord-named branches may be renamed automatically.
    branchOrigin: text('branch_origin'),
    // `.chord.json` `scripts.setup` for this checkout: 'pending' | 'running' |
    // 'ok' | 'failed' | 'skipped' (the user chose Don't run). Null means setup
    // is not tracked for this row (created before setup became state), which
    // gates nothing.
    setupStatus: text('setup_status'),
    setupLogPath: text('setup_log_path'),
    // Hash of the executable bundle the user approved for this lane only
    // (workspaces/executable-bundle.ts). Covers its setup, shellSetup at
    // agent start and teardown at removal, for that content and anything
    // that runs less of it (workspaces/script-approval.ts).
    approvedScriptsHash: text('approved_scripts_hash'),
    // That bundle's content (JSON `BundleContent`), what "runs less of it"
    // is checked against. Null for approvals recorded before it was kept:
    // those cover exactly their hash.
    approvedScripts: text('approved_scripts'),
    // First port of this lane's block (CHORD_PORT). Allocated once, checked
    // against every other lane's block, and kept for the lane's lifetime.
    portBase: integer('port_base'),
    // Where `fork_sha` came from (repo-config/resolve-lane-base.ts ForkSource):
    // 'fetched' | 'local_copy' — the last-fetched copy the user chose when the
    // fetch failed, shown on the lane — | 'local'. Null for a checkout of an
    // existing branch, and for rows from before it was recorded.
    forkSource: text('fork_source'),
    // 'chord' | 'adopted' (worktree-sources/adopt-worktree.ts): Chord never
    // changes an adopted checkout's files or git's worktree list.
    checkoutOrigin: text('checkout_origin').notNull().default('chord'),
    // The companion repository's linked worktree this lane's checkout is
    // nested in (work-items/companion-checkout.ts), and that companion's main
    // checkout, which git runs against once the worktree is gone. Both null for
    // a lane without a companion. Personal paths: never synced to the cloud.
    companionPath: text('companion_path'),
    companionRepoPath: text('companion_repo_path'),
  },
  (table) => ({
    workItemIdIdx: index('idx_work_item_worktrees_work_item_id').on(table.workItemId),
    pathIdx: index('idx_work_item_worktrees_path').on(table.path),
    primaryPerWorkItemIdx: uniqueIndex('uq_work_item_worktrees_primary')
      .on(table.workItemId)
      .where(sql`is_primary = 1`),
  })
);

export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('chat'),
    agentProviderId: text('agent_provider_id'),
    // Set only for a plain shell terminal (`TerminalShellId`: 'cmd',
    // 'powershell', 'git-bash', 'zsh', …), which has no agent provider. Resume
    // relaunches the same shell from this.
    shell: text('shell'),
    communication: text('communication').notNull().default('pty'),
    externalSessionId: text('external_session_id'),
    title: text('title'),
    cwd: text('cwd'),
    status: text('status').notNull().default('active'),
    respawnCount: integer('respawn_count').notNull().default(0),
    provisionStatus: text('provision_status').notNull().default('pending'),
    // Terminal outcome of this session's most recently completed turn —
    // 'error' when the stream ended in an error item or a non-zero process
    // exit, null otherwise (including "no turn has finished yet"). Set and
    // cleared in AgentEventBridge.completeTurn (persist-agent-turn.ts);
    // deliberately separate from `status` (session lifecycle: active/
    // suspended/done) so a resumed session isn't silently un-flagged. Read
    // by sidebar-worktree-summaries.ts as the `lastTurnErrored` signal.
    lastTurnStatus: text('last_turn_status'),
    lastTurnStatusAt: integer('last_turn_status_at'),
    // What this session ACTUALLY launched with, provider-resolved, written by
    // session-service's launch path (session-launch-model.ts). Deliberately
    // separate from the `session-config:<id>` kv override, which is what the
    // user CHOSE: that store is sparse (undefined means "inherit the work
    // item") and is deleted once the session reaches 'done'
    // (session-config-persistence.ts:41-44), so it cannot answer what a
    // finished session ran. Same intent-vs-record split as `last_turn_status`
    // above. Null until the session launches, and for terminals, which launch
    // a CLI rather than a model.
    model: text('model'),
    worktreeId: text('worktree_id').references(() => workItemWorktrees.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    lastActiveAt: integer('last_active_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    workItemIdIdx: index('idx_agent_sessions_work_item_id').on(table.workItemId),
    statusIdx: index('idx_agent_sessions_status').on(table.status),
    worktreeIdIdx: index('idx_agent_sessions_worktree_id').on(table.worktreeId),
    // Session import asks "does Chord already hold this agent session?" on
    // every import (session-import/owned-sessions.ts).
    externalSessionIdIdx: index('idx_agent_sessions_external_session_id').on(
      table.externalSessionId
    ),
  })
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    // Provenance, not a local foreign key: this is the agent_sessions.id of the
    // device that PRODUCED the message, and cloud ingest (chat-ingestion.ts)
    // writes teammates' session ids, which have no row in this device's
    // agent_sessions. Declaring a reference here would reject every ingested
    // agent message once foreign keys are enforced. No local query joins or
    // filters on it — see idx_chat_messages_work_item_id for the read path.
    sessionId: text('session_id'),
    senderType: text('sender_type').notNull(),
    senderId: text('sender_id'),
    senderName: text('sender_name'),
    content: text('content').notNull(),
    messageType: text('message_type').notNull().default('text'),
    metadata: text('metadata').default('{}'),
    // The agent turn an `agent_turn` message records — the join key to
    // `checkpoints.turn_id`, which previously lived only inside `metadata`.
    turnId: text('turn_id'),
    // An `agent_turn`'s history ref: where the agent's conversation can be
    // cut after the turn (Claude's last transcript entry uuid, Codex's turn
    // id). Local only, never synced: it names the agent's files on this device.
    historyRef: text('history_ref'),
    cloudId: text('cloud_id'),
    syncedAt: integer('synced_at'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    // The same moment to the millisecond: a chat is ordered by it, because a
    // prompt sent the second its previous turn finished shares that turn's
    // second (devstation-vihv). Every writer sets it; rows older than the
    // column were given the start of their second.
    createdAtMs: integer('created_at_ms'),
  },
  (table) => ({
    workItemIdIdx: index('idx_chat_messages_work_item_id').on(table.workItemId, table.createdAt),
    sessionIdIdx: index('idx_chat_messages_session_id').on(table.sessionId),
    turnIdIdx: index('idx_chat_messages_turn_id').on(table.turnId),
  })
);

export const workItemTickets = sqliteTable(
  'work_item_tickets',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    ticketId: text('ticket_id').notNull(),
    ticketUrl: text('ticket_url'),
    ticketProvider: text('ticket_provider').notNull(),
    /** The ticket's title when it was linked; null when the lookup couldn't read it. */
    ticketTitle: text('ticket_title'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    workItemIdIdx: index('idx_work_item_tickets_work_item_id').on(table.workItemId),
  })
);

export type WorkItemRow = typeof workItems.$inferSelect;
export type WorkItemInsert = typeof workItems.$inferInsert;
export type AgentSessionRow = typeof agentSessions.$inferSelect;
export type AgentSessionInsert = typeof agentSessions.$inferInsert;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ChatMessageInsert = typeof chatMessages.$inferInsert;
export type RepoRow = typeof repos.$inferSelect;
export type RepoInsert = typeof repos.$inferInsert;
export type WorkItemTicketRow = typeof workItemTickets.$inferSelect;
export type WorkItemTicketInsert = typeof workItemTickets.$inferInsert;
export type WorkItemWorktreeRow = typeof workItemWorktrees.$inferSelect;
export type WorkItemWorktreeInsert = typeof workItemWorktrees.$inferInsert;
