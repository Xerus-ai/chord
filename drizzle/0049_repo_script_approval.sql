ALTER TABLE `repo_settings` ADD `trusted_scripts_hash` text;--> statement-breakpoint
ALTER TABLE `repo_settings` ADD `trusted_scripts` text;--> statement-breakpoint
ALTER TABLE `repo_settings` ADD `trusted_remote_url` text;--> statement-breakpoint
ALTER TABLE `work_item_worktrees` ADD `approved_scripts_hash` text;--> statement-breakpoint
ALTER TABLE `repo_settings` DROP COLUMN `trust_decision`;--> statement-breakpoint
ALTER TABLE `repo_settings` DROP COLUMN `trusted_config_oid`;