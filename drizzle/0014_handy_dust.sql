CREATE TABLE `artifact_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`parent_comment_id` text,
	`body` text NOT NULL,
	`author_name` text DEFAULT 'User' NOT NULL,
	`anchor_key` text,
	`anchor_text` text,
	`resolved` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_comments_artifact_id` ON `artifact_comments` (`artifact_id`);