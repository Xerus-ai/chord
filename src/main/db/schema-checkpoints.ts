import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { workItems, workItemWorktrees } from './schema-work-items';

export const checkpoints = sqliteTable(
  'checkpoints',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    /** NULL for pre_revert safety checkpoints — they belong to no turn. */
    turnId: text('turn_id'),
    sessionId: text('session_id'),
    commitSha: text('commit_sha').notNull(),
    gitRef: text('git_ref').notNull(),
    trigger: text('trigger').notNull().default('turn_completed'),
    branchName: text('branch_name'),
    worktreeId: text('worktree_id').references(() => workItemWorktrees.id, {
      onDelete: 'cascade',
    }),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    workItemIdIdx: index('idx_checkpoints_work_item_id').on(table.workItemId, table.createdAt),
  })
);

export type CheckpointRow = typeof checkpoints.$inferSelect;
export type CheckpointInsert = typeof checkpoints.$inferInsert;
