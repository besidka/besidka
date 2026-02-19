CREATE TABLE `files` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`storage_key` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_storageKey_unique` ON `files` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_file_user` ON `files` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_file_storageKey` ON `files` (`storage_key`);--> statement-breakpoint
CREATE TABLE `storages` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`storage` integer DEFAULT 20971520 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_storage_user` ON `storages` (`id`,`user_id`);
