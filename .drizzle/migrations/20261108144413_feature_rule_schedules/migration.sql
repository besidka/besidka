CREATE TABLE `feature_rule_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`flag` text NOT NULL,
	`change` text NOT NULL,
	`run_at` integer NOT NULL,
	`status` text NOT NULL,
	`requires_notice_id` text,
	`created_by` integer,
	`claimed_at` integer,
	`applied_at` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feature_rule_schedules_status_run_at` ON `feature_rule_schedules` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `idx_feature_rule_schedules_flag` ON `feature_rule_schedules` (`flag`,`run_at`);