CREATE TABLE `research_jobs` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`user_message_id` text NOT NULL,
	`provider` text NOT NULL,
	`level` text NOT NULL,
	`model_id` text NOT NULL,
	`provider_job_id` text,
	`status` text NOT NULL,
	`error` text,
	`usage` text,
	`result_message_id` text,
	`started_at` integer,
	`completed_at` integer,
	CONSTRAINT `fk_research_jobs_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_research_jobs_chat_active` ON `research_jobs` (`chat_id`) WHERE status in ('pending', 'running');--> statement-breakpoint
CREATE INDEX `idx_research_jobs_status_created` ON `research_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_research_jobs_user` ON `research_jobs` (`user_id`);