CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`author_name` text,
	`label` text,
	`content` text DEFAULT '' NOT NULL,
	`byte_size` integer DEFAULT 0 NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_artifact_id` ON `artifact_versions` (`artifact_id`,`version_number`);