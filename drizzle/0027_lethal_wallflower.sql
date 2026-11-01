CREATE TABLE `agent_room_cursors` (
	`work_item_id` text PRIMARY KEY NOT NULL,
	`last_rowid` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
