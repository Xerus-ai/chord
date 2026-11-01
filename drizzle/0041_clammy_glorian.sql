CREATE TABLE `artifact_sources` (
	`artifact_id` text NOT NULL,
	`path` text NOT NULL,
	`content_hash` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `path`),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_sources_artifact_id` ON `artifact_sources` (`artifact_id`);