CREATE TABLE `confluence_publications` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`space_key` text NOT NULL,
	`page_id` text NOT NULL,
	`confluence_version` integer NOT NULL,
	`published_artifact_version` integer NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
