PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`role` text NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`reasoning` text DEFAULT 'off' NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_messages`(
	"id",
	"created_at",
	"updated_at",
	"chat_id",
	"role",
	"parts",
	"tools",
	"reasoning"
) SELECT
	"id",
	"created_at",
	"updated_at",
	"chat_id",
	"role",
	"parts",
	"tools",
	CASE
		WHEN "reasoning" = 1 THEN 'medium'
		ELSE 'off'
	END
FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_message_chat` ON `messages` (`id`,`chat_id`);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`reasoning_expanded` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_settings_user` ON `user_settings` (`user_id`);
