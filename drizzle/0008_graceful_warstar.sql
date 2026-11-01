CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text DEFAULT 'markdown' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'in_progress',
	`cloud_id` text,
	`synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_id` text,
	`sender_name` text,
	`content` text NOT NULL,
	`message_type` text DEFAULT 'text' NOT NULL,
	`metadata` text DEFAULT '{}',
	`cloud_id` text,
	`synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
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
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_work_item_id` ON `artifacts` (`work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_work_item_id` ON `chat_messages` (`work_item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_work_items_task_id` ON `work_items` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_work_items_status` ON `work_items` (`status`);