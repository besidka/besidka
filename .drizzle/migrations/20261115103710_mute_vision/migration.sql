CREATE TABLE `legal_consent_version_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version` text NOT NULL,
	`consent_text_sha256` text NOT NULL,
	`approved_by` integer,
	`approved_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legal_notice_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`notice_id` text NOT NULL,
	`notice_hash` text NOT NULL,
	`recipient_estimate` integer NOT NULL,
	`approved_by` integer,
	`approved_at` integer NOT NULL,
	`withdrawn_by` integer,
	`withdrawn_at` integer
);
--> statement-breakpoint
CREATE TABLE `legal_notice_email_optouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_legal_notice_approvals_active` ON `legal_notice_approvals` (`notice_id`) WHERE withdrawn_at is null;--> statement-breakpoint
CREATE INDEX `idx_legal_notice_approvals_notice` ON `legal_notice_approvals` (`notice_id`,`approved_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_legal_notice_email_optouts_user` ON `legal_notice_email_optouts` (`user_id`);