CREATE TABLE `published_plan_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`session_id` text,
	`title` text NOT NULL,
	`overview` text NOT NULL,
	`steps` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`turn_id` text,
	`session_id` text,
	`commit_sha` text NOT NULL,
	`git_ref` text NOT NULL,
	`trigger` text DEFAULT 'turn_completed' NOT NULL,
	`branch_name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_published_plans_session` ON `published_plan_requests` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_checkpoints_work_item_id` ON `checkpoints` (`work_item_id`,`created_at`);