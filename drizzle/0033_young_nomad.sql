ALTER TABLE `work_items` ADD `provision_status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `provision_error` text;