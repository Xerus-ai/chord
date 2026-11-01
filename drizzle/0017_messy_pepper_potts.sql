CREATE TABLE `agent_sessions` (
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
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
DROP INDEX IF EXISTS `idx_work_items_task_id`;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `session_id` text REFERENCES agent_sessions(id);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_work_item_id` ON `agent_sessions` (`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_status` ON `agent_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_session_id` ON `chat_messages` (`session_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `work_items_new` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`workflow_phase` text DEFAULT 'build',
	`ticket_id` text,
	`ticket_provider` text,
	`ticket_url` text,
	`pr_number` integer,
	`pr_url` text,
	`repo_path` text NOT NULL,
	`repo_alias` text,
	`branch_name` text,
	`agent_provider` text,
	`shared_with` text DEFAULT '[]',
	`sharing_level` text DEFAULT 'private',
	`cloud_id` text,
	`synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`repo_id` text REFERENCES repos(id),
	`effort` text DEFAULT 'high'
);--> statement-breakpoint
INSERT INTO `work_items_new` SELECT `id`, `name`, `status`, `workflow_phase`, `ticket_id`, `ticket_provider`, `ticket_url`, `pr_number`, `pr_url`, `repo_path`, `repo_alias`, `branch_name`, `agent_provider`, `shared_with`, `sharing_level`, `cloud_id`, `synced_at`, `created_at`, `updated_at`, `repo_id`, `effort` FROM `work_items`;--> statement-breakpoint
DROP TABLE `work_items`;--> statement-breakpoint
ALTER TABLE `work_items_new` RENAME TO `work_items`;--> statement-breakpoint
CREATE INDEX `idx_work_items_status` ON `work_items` (`status`);--> statement-breakpoint
PRAGMA foreign_keys=ON;