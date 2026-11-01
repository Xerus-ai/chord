CREATE TABLE `agent_session_superseded_ids` (
	`session_id` text NOT NULL,
	`external_session_id` text NOT NULL,
	`superseded_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`session_id`, `external_session_id`),
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_session_superseded_ids_external_session_id` ON `agent_session_superseded_ids` (`external_session_id`);