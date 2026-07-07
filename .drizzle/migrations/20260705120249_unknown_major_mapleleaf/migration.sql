ALTER TABLE `chats` RENAME COLUMN `forked_from_share_slug` TO `branched_from_share_slug`;--> statement-breakpoint
ALTER TABLE `chat_shares` ADD `show_author_avatar` integer DEFAULT true NOT NULL;