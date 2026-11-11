CREATE TABLE `documents` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`origin_chat_id` integer,
	`origin_message_id` integer,
	`origin_message_public_id` text,
	`format` text NOT NULL,
	`title` text,
	`spec_r2_key` text,
	`spec_version` integer,
	`spec_bytes` integer,
	`stats` text,
	`status` text NOT NULL,
	`render_lease_until` integer,
	`render_attempts` integer NOT NULL,
	`file_id` integer,
	`rendered_by` text,
	`error_code` text,
	`created_via` text NOT NULL,
	`origin_provider` text,
	`origin_model` text
);
--> statement-breakpoint
CREATE INDEX `idx_documents_user_updated` ON `documents` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_chat` ON `documents` (`origin_chat_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_file` ON `documents` (`file_id`);