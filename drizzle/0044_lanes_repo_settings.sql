CREATE TABLE `repo_settings` (
	`repo_id` text PRIMARY KEY NOT NULL,
	`overrides` text DEFAULT '{}' NOT NULL,
	`trust_decision` text,
	`trusted_config_oid` text,
	`trust_decided_at` integer,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `turn_id` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `target_ref` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `fork_sha` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `branch_origin` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `setup_status` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `setup_log_path` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `port_base` integer;--> statement-breakpoint
CREATE INDEX `idx_chat_messages_turn_id` ON `chat_messages` (`turn_id`);