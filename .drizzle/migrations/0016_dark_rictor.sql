CREATE TABLE `projects` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`instructions` text,
	`memory` text,
	`memory_status` text DEFAULT 'idle' NOT NULL,
	`memory_updated_at` integer,
	`memory_dirty_at` integer,
	`memory_provider` text,
	`memory_model` text,
	`memory_error` text,
	`pinned_at` integer,
	`archived_at` integer,
	`activity_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_user` ON `projects` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_activity_at` ON `projects` (`activity_at`);--> statement-breakpoint
ALTER TABLE `chats` ADD `activity_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `chats`
SET `activity_at` = COALESCE(`updated_at`, `created_at`, 0);--> statement-breakpoint
CREATE INDEX `idx_chats_activity_at` ON `chats` (`activity_at`);--> statement-breakpoint
ALTER TABLE `chats` ADD `project_id` integer REFERENCES `projects`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `chats` ADD `project_memory_summary` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `project_memory_summary_updated_at` integer;--> statement-breakpoint
