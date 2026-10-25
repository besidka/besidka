ALTER TABLE `user_settings` ADD `memory_extraction_enabled_at` integer;--> statement-breakpoint
CREATE INDEX `idx_user_settings_extraction_enabled` ON `user_settings` (`user_id`) WHERE memory_extraction_enabled = 1;--> statement-breakpoint
CREATE INDEX `idx_chats_user_activity` ON `chats` (`user_id`,`activity_at`);