CREATE TABLE `google_connections` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`client_mode` text NOT NULL,
	`google_subject` text,
	`google_email` text,
	`granted_scopes` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`access_token_expires_at` integer,
	`status` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `google_data_at` integer;--> statement-breakpoint
ALTER TABLE `keys` ADD `paid_tier_confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `external_source` text;--> statement-breakpoint
ALTER TABLE `files` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `files` ADD `external_modified_at` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `drive_copy_id` text;--> statement-breakpoint
CREATE INDEX `idx_files_user_external` ON `files` (`user_id`,`external_source`,`external_id`) WHERE external_source IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_google_connections_user_mode` ON `google_connections` (`user_id`,`client_mode`);--> statement-breakpoint
CREATE INDEX `idx_google_connections_user` ON `google_connections` (`user_id`);