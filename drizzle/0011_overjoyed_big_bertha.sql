CREATE TABLE `cloud_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`org_id` text,
	`role` text DEFAULT 'member',
	`cached_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_type` text NOT NULL,
	`in_app` integer DEFAULT 1 NOT NULL,
	`desktop` integer DEFAULT 1 NOT NULL,
	`sound` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending',
	`retry_count` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_users_email` ON `cloud_users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_sync_queue_status` ON `sync_queue` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sync_queue_entity` ON `sync_queue` (`entity_type`,`entity_id`);