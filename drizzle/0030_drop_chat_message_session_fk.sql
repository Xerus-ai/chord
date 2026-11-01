/*
 drizzle-kit cannot generate a foreign-key drop for SQLite, so the table
 rebuild is written out here (the file drizzle-kit emitted for this diff).

 chat_messages.session_id names the agent_sessions row on the device that
 PRODUCED the message. Cloud ingest replays teammates' messages, whose
 session ids have no row in this device's agent_sessions, so the reference
 was never satisfiable and would reject every ingested agent message once
 foreign keys are enforced. The column and its index stay; only the
 constraint goes. See src/main/db/schema-work-items.ts.

 Foreign keys are off for the whole migration run (db/initialize.ts), so the
 DROP below is a plain table drop. chat_messages is a leaf — nothing
 references it — so there is nothing to cascade into either way.
*/
CREATE TABLE `__new_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`session_id` text,
	`sender_type` text NOT NULL,
	`sender_id` text,
	`sender_name` text,
	`content` text NOT NULL,
	`message_type` text DEFAULT 'text' NOT NULL,
	`metadata` text DEFAULT '{}',
	`cloud_id` text,
	`synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_chat_messages` (`id`, `work_item_id`, `session_id`, `sender_type`, `sender_id`, `sender_name`, `content`, `message_type`, `metadata`, `cloud_id`, `synced_at`, `created_at`) SELECT `id`, `work_item_id`, `session_id`, `sender_type`, `sender_id`, `sender_name`, `content`, `message_type`, `metadata`, `cloud_id`, `synced_at`, `created_at` FROM `chat_messages`;--> statement-breakpoint
DROP TABLE `chat_messages`;--> statement-breakpoint
ALTER TABLE `__new_chat_messages` RENAME TO `chat_messages`;--> statement-breakpoint
CREATE INDEX `idx_chat_messages_work_item_id` ON `chat_messages` (`work_item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_session_id` ON `chat_messages` (`session_id`);
