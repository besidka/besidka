CREATE TABLE `connector_chat_settings` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`chat_public_id` integer NOT NULL,
	`connector_id` integer NOT NULL,
	`enabled` integer NOT NULL,
	`always_allow_tools` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connector_credentials` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`connector_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`issuer` text NOT NULL,
	`client_registration` text,
	`access_token` text,
	`refresh_token` text,
	`header_name` text,
	`header_value` text,
	`scope` text,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `connector_tool_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` integer NOT NULL,
	`connector_id` integer NOT NULL,
	`connector_host` text NOT NULL,
	`chat_public_id` integer,
	`tool_name` text NOT NULL,
	`args_hmac` text NOT NULL,
	`result_bytes` integer NOT NULL,
	`outcome` text NOT NULL,
	`approval` text NOT NULL,
	`path` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connector_tool_settings` (
	`id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`connector_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`tool_name` text NOT NULL,
	`definition_hash` text NOT NULL,
	`server_read_only` integer NOT NULL,
	`enabled` integer NOT NULL,
	`approval` text NOT NULL,
	`approved_definition_hash` text
);
--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`origin` text NOT NULL,
	`url_encrypted` text NOT NULL,
	`transport` text NOT NULL,
	`auth_type` text,
	`status` text NOT NULL,
	`enabled` integer NOT NULL,
	`preset_id` text,
	`created_via` text NOT NULL,
	`created_by_client_id` text,
	`consent_origin` text,
	`consent_issuer` text,
	`consent_version` text,
	`consented_at` integer,
	`consent_withdrawn_at` integer,
	`native_opt_in_at` integer,
	`last_error` text,
	`last_connected_at` integer
);
--> statement-breakpoint
CREATE TABLE `mcp_registry_servers` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`title` text,
	`description` text NOT NULL,
	`remote_url` text NOT NULL,
	`remote_type` text NOT NULL,
	`header_names` text NOT NULL,
	`status` text NOT NULL,
	`registry_updated_at` integer NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_connector_chat_settings_chat_connector` ON `connector_chat_settings` (`chat_public_id`,`connector_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_chat_settings_user` ON `connector_chat_settings` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_chat_settings_connector` ON `connector_chat_settings` (`connector_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_connector_credentials_connector_issuer` ON `connector_credentials` (`connector_id`,`issuer`);--> statement-breakpoint
CREATE INDEX `idx_connector_credentials_user` ON `connector_credentials` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_connector_tool_calls_user_created` ON `connector_tool_calls` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_connector_tool_calls_created` ON `connector_tool_calls` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_connector_tool_settings_connector_tool` ON `connector_tool_settings` (`connector_id`,`tool_name`);--> statement-breakpoint
CREATE INDEX `idx_connector_tool_settings_user` ON `connector_tool_settings` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_connectors_user_slug` ON `connectors` (`user_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_connectors_user_updated` ON `connectors` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_mcp_registry_servers_name` ON `mcp_registry_servers` (`name`);