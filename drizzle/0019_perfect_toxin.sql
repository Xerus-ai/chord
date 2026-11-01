CREATE TABLE `work_item_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`ticket_url` text,
	`ticket_provider` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `external_session_id` text;--> statement-breakpoint
CREATE INDEX `idx_work_item_tickets_work_item_id` ON `work_item_tickets` (`work_item_id`);--> statement-breakpoint
ALTER TABLE `work_items` DROP COLUMN `workflow_phase`;--> statement-breakpoint
ALTER TABLE `work_items` DROP COLUMN `ticket_id`;--> statement-breakpoint
ALTER TABLE `work_items` DROP COLUMN `ticket_provider`;--> statement-breakpoint
ALTER TABLE `work_items` DROP COLUMN `ticket_url`;