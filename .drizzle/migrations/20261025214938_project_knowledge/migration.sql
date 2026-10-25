CREATE TABLE `project_knowledge_items` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_id` integer,
	`title` text NOT NULL,
	`description` text,
	`relative_path` text,
	`folder_id` text,
	`media_type` text,
	`size_bytes` integer,
	`page_count` integer,
	`content_hash` text,
	`text_bytes` integer NOT NULL,
	`latin_chars` integer NOT NULL,
	`cyrillic_chars` integer NOT NULL,
	`other_chars` integer NOT NULL,
	`extract_status` text NOT NULL,
	`extract_error` text,
	`extractor` text NOT NULL,
	`send_as_native_pdf` integer,
	`pinned` integer,
	CONSTRAINT `fk_project_knowledge_items_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_knowledge_items_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_knowledge_items_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `knowledge_mode` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `knowledge_version` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `knowledge_pack_version` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_knowledge_items_project_hash` ON `project_knowledge_items` (`project_id`,`content_hash`) WHERE content_hash is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_knowledge_items_project_file` ON `project_knowledge_items` (`project_id`,`file_id`) WHERE file_id is not null;--> statement-breakpoint
CREATE INDEX `idx_project_knowledge_items_user_project` ON `project_knowledge_items` (`user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_knowledge_items_file` ON `project_knowledge_items` (`file_id`);