CREATE TABLE `skill_chat_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` integer NOT NULL,
	`chat_public_id` integer NOT NULL,
	`skill_id` integer NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skill_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`skill_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`version` integer NOT NULL,
	`path` text NOT NULL,
	`blob_sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skill_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`skill_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`version` integer NOT NULL,
	`origin` text NOT NULL,
	`created_by_client_id` text,
	`source_version` text,
	`sha256` text NOT NULL,
	`files_count` integer NOT NULL,
	`bytes` integer NOT NULL,
	`license_class` text NOT NULL,
	`license_file_sha256` text,
	`findings` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`license_field` text,
	`license_class` text NOT NULL,
	`license_file_sha256` text,
	`license_classifier_version` integer NOT NULL,
	`compatibility` text,
	`metadata` text,
	`allowed_tools` text,
	`source_kind` text NOT NULL,
	`source_url` text,
	`source_ref` text,
	`source_version` text,
	`source_path` text,
	`current_version` integer NOT NULL,
	`pending_version` integer,
	`files_count` integer NOT NULL,
	`bytes` integer NOT NULL,
	`enabled` integer NOT NULL,
	`model_invocable` integer NOT NULL,
	`slash_command` integer NOT NULL,
	`argument_hint` text,
	`allow_scripts` integer NOT NULL,
	`status` text NOT NULL,
	`created_via` text NOT NULL,
	`created_by_client_id` text,
	`provider_skill_id` text,
	`provider_skill_version` text,
	`provider_uploaded_name` text,
	`provider_deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skill_chat_settings_chat_skill` ON `skill_chat_settings` (`chat_public_id`,`skill_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_chat_settings_user` ON `skill_chat_settings` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_chat_settings_skill` ON `skill_chat_settings` (`skill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skill_files_skill_version_path` ON `skill_files` (`skill_id`,`version`,`path`);--> statement-breakpoint
CREATE INDEX `idx_skill_files_user` ON `skill_files` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_files_skill_blob` ON `skill_files` (`skill_id`,`blob_sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skill_versions_skill_version` ON `skill_versions` (`skill_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_skill_versions_user` ON `skill_versions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skills_user_name` ON `skills` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_skills_user_updated` ON `skills` (`user_id`,`updated_at`);