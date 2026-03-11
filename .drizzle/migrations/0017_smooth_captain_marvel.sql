CREATE TABLE `folders` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`pinned_at` integer,
	`archived_at` integer,
	`activity_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_folder_user` ON `folders` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_folders_activity_at` ON `folders` (`activity_at`);--> statement-breakpoint
ALTER TABLE `chats` ADD `folder_id` integer REFERENCES folders(id);