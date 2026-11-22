CREATE TABLE `besidka_chat_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`chat_public_id` integer NOT NULL,
	`enabled` integer NOT NULL,
	`always_allow_tools` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `besidka_tool_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`tool_name` text NOT NULL,
	`mode` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_approval_claims` (
	`approval_id` text PRIMARY KEY,
	`user_id` integer NOT NULL,
	`chat_public_id` integer NOT NULL,
	`message_public_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_besidka_chat_settings_user_chat` ON `besidka_chat_settings` (`user_id`,`chat_public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_besidka_tool_permissions_user_tool` ON `besidka_tool_permissions` (`user_id`,`tool_name`);--> statement-breakpoint
CREATE INDEX `idx_tool_approval_claims_created` ON `tool_approval_claims` (`created_at`);