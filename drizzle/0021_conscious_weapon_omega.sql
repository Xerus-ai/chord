CREATE TABLE `sync_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`last_attempted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sync_queue_status` ON `sync_queue` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sync_queue_entity` ON `sync_queue` (`entity_id`);