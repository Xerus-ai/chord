ALTER TABLE `agent_sessions` ADD `last_turn_status` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `last_turn_status_at` integer;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `git_last_error` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `git_last_error_at` integer;