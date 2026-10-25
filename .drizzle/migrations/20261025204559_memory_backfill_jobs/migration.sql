CREATE TABLE `memory_backfill_jobs` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`status` text NOT NULL,
	`finished_at` integer,
	`total_chats` integer NOT NULL,
	`processed_chats` integer NOT NULL,
	`created_entries` integer NOT NULL,
	`updated_entries` integer NOT NULL,
	`skipped_chats` integer NOT NULL,
	`failed_chats` integer NOT NULL,
	`consecutive_failures` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`failure_reason` text,
	`dropped` text,
	`model_source` text,
	`model_provider_id` text,
	`model_gateway_id` text,
	`model_id` text,
	`estimate` text,
	`created_before` integer NOT NULL,
	`cursor_activity_at` integer,
	`cursor_chat_id` integer,
	`retried_chat_id` integer,
	`chat_attempts` integer NOT NULL,
	`lease_until` integer,
	CONSTRAINT `fk_memory_backfill_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memory_backfill_jobs_user_running` ON `memory_backfill_jobs` (`user_id`) WHERE status = 'running';--> statement-breakpoint
CREATE INDEX `idx_memory_backfill_jobs_user_created` ON `memory_backfill_jobs` (`user_id`,`created_at`);