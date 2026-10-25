CREATE TABLE `memory_entries` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer,
	`category` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`sensitivity` text NOT NULL,
	`sensitive_category` text,
	`origin` text NOT NULL,
	`source_chat_ids` text NOT NULL,
	`source_message_id` text,
	`last_used_at` integer,
	CONSTRAINT `fk_memory_entries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_entries_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `user_settings` ADD `memory_enabled` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `chat_search_enabled` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `memory_include_sensitive` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `about_me` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `profile_memory_model` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `profile_memory_gateway` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `project_memory_model` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `project_memory_gateway` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `use_account_memory` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memory_entries_account_slug` ON `memory_entries` (`user_id`,`category`,`slug`) WHERE project_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memory_entries_project_slug` ON `memory_entries` (`user_id`,`project_id`,`category`,`slug`) WHERE project_id is not null;--> statement-breakpoint
CREATE INDEX `idx_memory_entries_user_project` ON `memory_entries` (`user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_user_sensitivity` ON `memory_entries` (`user_id`,`sensitivity`);