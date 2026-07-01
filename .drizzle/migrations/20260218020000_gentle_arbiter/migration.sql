ALTER TABLE `storages` ADD `file_retention_days` integer DEFAULT 30;
--> statement-breakpoint
ALTER TABLE `files` ADD `expires_at` integer;
--> statement-breakpoint
CREATE INDEX `idx_files_expires_at` ON `files` (`expires_at`);
