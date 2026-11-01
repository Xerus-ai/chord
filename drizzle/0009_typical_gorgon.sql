CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`alias` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `work_items` ADD `repo_id` text REFERENCES repos(id);--> statement-breakpoint
CREATE UNIQUE INDEX `repos_path_unique` ON `repos` (`path`);