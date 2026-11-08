CREATE TABLE `feature_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`actor_user_id` integer,
	`actor_kind` text NOT NULL,
	`client_id` text,
	`action` text NOT NULL,
	`flag` text,
	`target_user_id` integer,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature_flag_rules` (
	`flag` text PRIMARY KEY,
	`enabled` integer NOT NULL,
	`rollout_bps` integer NOT NULL,
	`allow_roles` text,
	`variants` text,
	`salt` text NOT NULL,
	`updated_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` integer NOT NULL,
	`flag` text NOT NULL,
	`effect` text NOT NULL,
	`variant` text,
	`expires_at` integer,
	`reason` text,
	`granted_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature_opt_ins` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` integer NOT NULL,
	`flag` text NOT NULL,
	`opted_in_at` integer,
	`opted_out_at` integer
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`granted_by` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feature_audit_created` ON `feature_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_feature_audit_flag` ON `feature_audit_log` (`flag`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_feature_audit_target` ON `feature_audit_log` (`target_user_id`);--> statement-breakpoint
CREATE INDEX `idx_feature_audit_actor` ON `feature_audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feature_grants_user_flag` ON `feature_grants` (`user_id`,`flag`);--> statement-breakpoint
CREATE INDEX `idx_feature_grants_flag` ON `feature_grants` (`flag`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feature_opt_ins_user_flag` ON `feature_opt_ins` (`user_id`,`flag`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_roles_user_role` ON `user_roles` (`user_id`,`role`);