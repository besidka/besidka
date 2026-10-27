ALTER TABLE `user_settings` ADD `memory_extraction_enabled` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `memory_migrated_at` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `memory_extracted_at` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `memory_extraction_attempted_at` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `memory_extraction_failures` integer;