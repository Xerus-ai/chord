CREATE TABLE `work_item_worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`path` text NOT NULL,
	`branch_name` text,
	`base_branch` text,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `worktree_id` text REFERENCES work_item_worktrees(id);--> statement-breakpoint
ALTER TABLE `checkpoints` ADD `worktree_id` text REFERENCES work_item_worktrees(id);--> statement-breakpoint
CREATE INDEX `idx_work_item_worktrees_work_item_id` ON `work_item_worktrees` (`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_work_item_worktrees_path` ON `work_item_worktrees` (`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_item_worktrees_primary` ON `work_item_worktrees` (`work_item_id`) WHERE is_primary = 1;--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_worktree_id` ON `agent_sessions` (`worktree_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/
--> statement-breakpoint
/*
 The two ALTER TABLE ... ADD ... REFERENCES statements above physically drop
 the ON DELETE clause — SQLite cannot attach one to a column added after table
 creation. Without the rebuild below, agent_sessions.worktree_id and
 checkpoints.worktree_id would carry ON DELETE NO ACTION, not the SET NULL /
 CASCADE the schema (src/main/db/schema-work-items.ts) declares. Migration
 0031 hit the same defect for work_items.repo_id (added by ALTER TABLE in
 0009) and fixed it the same way: a full table rebuild.

 Both tables are safe to rebuild here: they are leaves. chat_messages.session_id
 used to reference agent_sessions but that FK was dropped in 0030, and nothing
 references checkpoints. Foreign keys are off for the whole migration run
 (db/initialize.ts), so the DROP TABLE below does not cascade into anything —
 orphan checkpoints (rows whose work_item_id no longer exists, kept on purpose
 by 0031) survive the copy untouched.
*/
CREATE TABLE `__new_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`kind` text DEFAULT 'chat' NOT NULL,
	`agent_provider_id` text,
	`communication` text DEFAULT 'pty' NOT NULL,
	`title` text,
	`cwd` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_active_at` integer DEFAULT (unixepoch()) NOT NULL,
	`external_session_id` text,
	`respawn_count` integer DEFAULT 0 NOT NULL,
	`provision_status` text DEFAULT 'pending' NOT NULL,
	`worktree_id` text REFERENCES `work_item_worktrees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_sessions` (`id`, `work_item_id`, `kind`, `agent_provider_id`, `communication`, `title`, `cwd`, `status`, `created_at`, `last_active_at`, `external_session_id`, `respawn_count`, `provision_status`, `worktree_id`) SELECT `id`, `work_item_id`, `kind`, `agent_provider_id`, `communication`, `title`, `cwd`, `status`, `created_at`, `last_active_at`, `external_session_id`, `respawn_count`, `provision_status`, `worktree_id` FROM `agent_sessions`;
--> statement-breakpoint
DROP TABLE `agent_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;
--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_work_item_id` ON `agent_sessions` (`work_item_id`);
--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_status` ON `agent_sessions` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_worktree_id` ON `agent_sessions` (`worktree_id`);
--> statement-breakpoint
CREATE TABLE `__new_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`turn_id` text,
	`session_id` text,
	`commit_sha` text NOT NULL,
	`git_ref` text NOT NULL,
	`trigger` text DEFAULT 'turn_completed' NOT NULL,
	`branch_name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`worktree_id` text REFERENCES `work_item_worktrees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_checkpoints` (`id`, `work_item_id`, `turn_id`, `session_id`, `commit_sha`, `git_ref`, `trigger`, `branch_name`, `created_at`, `worktree_id`) SELECT `id`, `work_item_id`, `turn_id`, `session_id`, `commit_sha`, `git_ref`, `trigger`, `branch_name`, `created_at`, `worktree_id` FROM `checkpoints`;
--> statement-breakpoint
DROP TABLE `checkpoints`;
--> statement-breakpoint
ALTER TABLE `__new_checkpoints` RENAME TO `checkpoints`;
--> statement-breakpoint
CREATE INDEX `idx_checkpoints_work_item_id` ON `checkpoints` (`work_item_id`,`created_at`);
--> statement-breakpoint
INSERT INTO `work_item_worktrees` (`id`, `work_item_id`, `path`, `branch_name`, `is_primary`, `created_at`)
  SELECT lower(hex(randomblob(16))), `id`, `repo_path`, `branch_name`, 1, `created_at` FROM `work_items`;
--> statement-breakpoint
UPDATE `agent_sessions` SET `worktree_id` = (SELECT w.`id` FROM `work_item_worktrees` w WHERE w.`work_item_id` = `agent_sessions`.`work_item_id` AND w.`is_primary` = 1);
--> statement-breakpoint
UPDATE `checkpoints` SET `worktree_id` = (SELECT w.`id` FROM `work_item_worktrees` w WHERE w.`work_item_id` = `checkpoints`.`work_item_id` AND w.`is_primary` = 1);