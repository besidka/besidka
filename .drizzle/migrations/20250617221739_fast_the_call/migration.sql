CREATE TABLE `accounts` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `users` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`slug` text NOT NULL,
	`user_id` integer NOT NULL,
	`title` text DEFAULT '',
	`shared` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chats_slug_unique` ON `chats` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chat_user` ON `chats` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chat_slug` ON `chats` (`id`,`slug`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_message_chat` ON `messages` (`id`,`chat_id`);--> statement-breakpoint
CREATE TABLE `keys` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`api_key` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_key_user` ON `keys` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_key_user_provider` ON `keys` (`user_id`,`provider`);