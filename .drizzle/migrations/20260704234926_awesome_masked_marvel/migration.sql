ALTER TABLE `chats` ADD `forked_from_share_slug` text;--> statement-breakpoint
ALTER TABLE `chat_shares` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `chat_shares` ADD `indexable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_shares` ADD `show_files` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_shares` ADD `show_metadata` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chat_share_slug` ON `chat_shares` (`slug`);