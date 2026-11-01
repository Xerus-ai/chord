CREATE TABLE `command_ledger` (
	`command_id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`executed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_command_ledger_work_item` ON `command_ledger` (`work_item_id`,`state`);