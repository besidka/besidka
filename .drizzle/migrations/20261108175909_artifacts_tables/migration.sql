CREATE TABLE `artifact_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`share_id` integer,
	`artifact_id` integer NOT NULL,
	`reporter_user_id` integer,
	`reporter_email` text,
	`reporter_name` text,
	`reason` text NOT NULL,
	`details` text,
	`status` text NOT NULL,
	`priority` text,
	`receipt_sent_at` integer,
	`decision` text,
	`decided_at` integer,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE TABLE `artifact_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`artifact_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`token_encrypted` text NOT NULL,
	`created_via` text NOT NULL,
	`client_id` text,
	`pinned_version` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`bridge_allowed` integer NOT NULL,
	`storage_allowed` integer NOT NULL,
	`takedown_at` integer,
	`takedown_reason` text
);
--> statement-breakpoint
CREATE TABLE `artifact_storage` (
	`artifact_id` integer NOT NULL,
	`viewer_user_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`bytes` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `artifact_storage_pk` PRIMARY KEY(`artifact_id`, `viewer_user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `artifact_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`artifact_id` integer NOT NULL,
	`version` integer NOT NULL,
	`r2_key` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_by` text NOT NULL,
	`model_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`origin_chat_id` integer,
	`origin_message_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`current_version` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`created_via` text NOT NULL,
	`takedown_at` integer,
	`takedown_reason` text,
	`legal_hold_until` integer
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_reports_status_created` ON `artifact_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_artifact_reports_artifact` ON `artifact_reports` (`artifact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_artifact_shares_token` ON `artifact_shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_artifact_shares_artifact` ON `artifact_shares` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_shares_user` ON `artifact_shares` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_storage_viewer` ON `artifact_storage` (`viewer_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_artifact_versions` ON `artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_user_updated` ON `artifacts` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_origin_chat` ON `artifacts` (`origin_chat_id`);