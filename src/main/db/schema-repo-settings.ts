import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { repos } from './schema-work-items';

/**
 * This machine's settings for one repository — the "Just me" layer of the
 * repo config resolver, and the repository-wide script approval.
 *
 * What gets approved is the repository's executable content — its committed
 * `.chord.json` scripts and any Claude config that runs code — hashed as one
 * bundle (`workspaces/executable-bundle.ts`), never the repository as such.
 * A lane's own approval lives on its row (`work_item_worktrees
 * .approved_scripts_hash`); this row holds the "Always trust" one, which
 * covers every lane of the repository for exactly that content.
 */
export const repoSettings = sqliteTable('repo_settings', {
  repoId: text('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  // JSON object of personal overrides (`repoJustMeSettingsSchema`).
  overrides: text('overrides').notNull().default('{}'),
  // "Always trust": the approved bundle's hash, and the bundle itself (the
  // base of the diff the next prompt shows). Null when nothing is always
  // trusted; Revoke clears all three.
  trustedScriptsHash: text('trusted_scripts_hash'),
  trustedScripts: text('trusted_scripts'),
  // The remote URL the approval was given for; a different remote drops it.
  trustedRemoteUrl: text('trusted_remote_url'),
  trustDecidedAt: integer('trust_decided_at'),
});

export type RepoSettingsRow = typeof repoSettings.$inferSelect;
