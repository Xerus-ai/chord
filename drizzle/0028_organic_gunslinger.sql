CREATE TABLE `published_permission_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`session_id` text,
	`options` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_published_permissions_session` ON `published_permission_requests` (`session_id`,`status`);