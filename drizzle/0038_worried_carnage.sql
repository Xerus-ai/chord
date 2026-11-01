CREATE TABLE `agent_thread_cursors` (
	`session_id` text PRIMARY KEY NOT NULL,
	`last_rowid` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
