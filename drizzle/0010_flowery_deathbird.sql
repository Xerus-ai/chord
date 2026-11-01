CREATE TABLE `pull_request_review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_request_url` text NOT NULL,
	`review_id` text NOT NULL,
	`path` text,
	`line` integer,
	`body` text NOT NULL,
	`author_login` text NOT NULL,
	`author_avatar_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pull_request_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_request_url` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`reviewer_login` text NOT NULL,
	`reviewer_avatar_url` text,
	`state` text NOT NULL,
	`submitted_at` text,
	`body` text,
	FOREIGN KEY (`pull_request_url`) REFERENCES `pull_requests`(`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_prrc_pull_request_url` ON `pull_request_review_comments` (`pull_request_url`);--> statement-breakpoint
CREATE INDEX `idx_prrc_review_id` ON `pull_request_review_comments` (`review_id`);--> statement-breakpoint
CREATE INDEX `idx_prr_pull_request_url` ON `pull_request_reviews` (`pull_request_url`);