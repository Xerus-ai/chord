ALTER TABLE `agent_sessions` ADD `respawn_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `provision_status` text DEFAULT 'pending' NOT NULL;