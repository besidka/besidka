CREATE TABLE `chat_share_files` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`chat_share_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	FOREIGN KEY (`chat_share_id`) REFERENCES `chat_shares`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chat_share_file` ON `chat_share_files` (`chat_share_id`,`file_id`);--> statement-breakpoint
CREATE TABLE `chat_shares` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chat_share_chat` ON `chat_shares` (`chat_id`,`id`);--> statement-breakpoint
CREATE TABLE `image_transform_usage_monthly` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`month_key` text PRIMARY KEY NOT NULL,
	`transforms_used` integer DEFAULT 0 NOT NULL,
	`transforms_limit` integer DEFAULT 4500 NOT NULL
);
--> statement-breakpoint
DROP INDEX `uq_storage_user`;--> statement-breakpoint
ALTER TABLE `storages` ADD `tier` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `storages` ADD `max_files_per_message` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `storages` ADD `max_message_files_bytes` integer DEFAULT 1048576000 NOT NULL;--> statement-breakpoint
ALTER TABLE `storages` ADD `image_transform_limit_total` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `storages` ADD `image_transform_used_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_storage_user` ON `storages` (`user_id`);