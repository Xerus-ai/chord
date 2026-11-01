/*
 Prepares the local database for `PRAGMA foreign_keys = ON` (enabled after
 migrations by src/main/db/initialize.ts).

 Two problems, both from foreign keys never having been enforced:

 1. work_items.repo_id was added by ALTER TABLE in 0009 (`ADD repo_id text
    REFERENCES repos(id)`) and carried forward verbatim by 0017's rebuild, so
    the physical constraint is ON DELETE NO ACTION even though the drizzle
    schema and snapshot both say `set null`. With enforcement on, deleting a
    repo that still has work items would fail instead of clearing repo_id.
    Fixed by rebuilding the table with the constraint the schema declares.

 2. Deleting a work item never removed its children (the cascades were inert),
    so old databases hold chat_messages/artifacts/agent_sessions/tickets whose
    parent is gone. Enabling foreign keys does not reject those rows — SQLite
    checks a child row only when it is inserted or its key columns change —
    but they are not harmless: the sync-queue startup backfills scan
    chat_messages and artifacts globally for synced_at IS NULL, so every
    orphan is re-enqueued on each launch and then burns the parent-missing
    grace period before giving up. They are swept once, here.

 Deliberately NOT swept: orphaned `checkpoints`. Each row is the only record
 of a `refs/chord/checkpoints/` ref, and releasing refs needs the deleted work
 item's repo path. Dropping the rows would strand those commits in the repo
 forever with nothing left naming them, which is exactly what
 checkpoints/checkpoint-service.ts orders its cleanup to avoid. Orphans there
 are tolerated by foreign-key enforcement and stop accumulating now that the
 cascade is live.

 Foreign keys are off for the whole migration run, so the rebuild below cannot
 cascade work_items' children away when the old table is dropped.
*/
DELETE FROM `chat_messages` WHERE `work_item_id` NOT IN (SELECT `id` FROM `work_items`);--> statement-breakpoint
DELETE FROM `agent_sessions` WHERE `work_item_id` NOT IN (SELECT `id` FROM `work_items`);--> statement-breakpoint
DELETE FROM `work_item_tickets` WHERE `work_item_id` NOT IN (SELECT `id` FROM `work_items`);--> statement-breakpoint
DELETE FROM `artifacts` WHERE `work_item_id` NOT IN (SELECT `id` FROM `work_items`);--> statement-breakpoint
DELETE FROM `artifact_comments` WHERE `artifact_id` NOT IN (SELECT `id` FROM `artifacts`);--> statement-breakpoint
DELETE FROM `artifact_versions` WHERE `artifact_id` NOT IN (SELECT `id` FROM `artifacts`);--> statement-breakpoint
DELETE FROM `editor_buffers` WHERE `project_id` NOT IN (SELECT `id` FROM `projects`);--> statement-breakpoint
DELETE FROM `project_remotes` WHERE `project_id` NOT IN (SELECT `id` FROM `projects`);--> statement-breakpoint
DELETE FROM `pull_request_labels` WHERE `pull_request_id` NOT IN (SELECT `url` FROM `pull_requests`);--> statement-breakpoint
DELETE FROM `pull_request_assignees` WHERE `pull_request_url` NOT IN (SELECT `url` FROM `pull_requests`);--> statement-breakpoint
DELETE FROM `pull_request_checks` WHERE `pull_request_url` NOT IN (SELECT `url` FROM `pull_requests`);--> statement-breakpoint
DELETE FROM `pull_request_reviews` WHERE `pull_request_url` NOT IN (SELECT `url` FROM `pull_requests`);--> statement-breakpoint
DELETE FROM `pull_request_review_comments` WHERE `pull_request_url` NOT IN (SELECT `url` FROM `pull_requests`);--> statement-breakpoint
UPDATE `projects` SET `ssh_connection_id` = NULL WHERE `ssh_connection_id` IS NOT NULL AND `ssh_connection_id` NOT IN (SELECT `id` FROM `ssh_connections`);--> statement-breakpoint
UPDATE `pull_requests` SET `author_user_id` = NULL WHERE `author_user_id` IS NOT NULL AND `author_user_id` NOT IN (SELECT `user_id` FROM `pull_request_users`);--> statement-breakpoint
CREATE TABLE `__new_work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pr_number` integer,
	`pr_url` text,
	`repo_id` text,
	`repo_path` text NOT NULL,
	`repo_alias` text,
	`branch_name` text,
	`effort` text DEFAULT 'high',
	`model` text,
	`agent_provider` text,
	`shared_with` text DEFAULT '[]',
	`sharing_level` text DEFAULT 'private',
	`cloud_id` text,
	`synced_at` integer,
	`cloud_version` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_work_items` (`id`, `name`, `status`, `pr_number`, `pr_url`, `repo_id`, `repo_path`, `repo_alias`, `branch_name`, `effort`, `model`, `agent_provider`, `shared_with`, `sharing_level`, `cloud_id`, `synced_at`, `cloud_version`, `created_at`, `updated_at`) SELECT `id`, `name`, `status`, `pr_number`, `pr_url`, CASE WHEN `repo_id` IN (SELECT `id` FROM `repos`) THEN `repo_id` END, `repo_path`, `repo_alias`, `branch_name`, `effort`, `model`, `agent_provider`, `shared_with`, `sharing_level`, `cloud_id`, `synced_at`, `cloud_version`, `created_at`, `updated_at` FROM `work_items`;--> statement-breakpoint
DROP TABLE `work_items`;--> statement-breakpoint
ALTER TABLE `__new_work_items` RENAME TO `work_items`;--> statement-breakpoint
CREATE INDEX `idx_work_items_status` ON `work_items` (`status`);
