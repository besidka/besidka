ALTER TABLE `chats` ADD `activity_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `chats` SET `activity_at` = COALESCE(`updated_at`, `created_at`, 0);--> statement-breakpoint
CREATE INDEX `idx_chats_activity_at` ON `chats` (`activity_at`);