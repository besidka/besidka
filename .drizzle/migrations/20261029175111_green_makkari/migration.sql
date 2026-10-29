CREATE TABLE `jwks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`alg` text,
	`crv` text
);
--> statement-breakpoint
CREATE TABLE `oauth_access_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`client_id` text NOT NULL,
	`session_id` integer,
	`user_id` integer,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` integer,
	`expires_at` integer NOT NULL,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_access_tokens_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`),
	CONSTRAINT `fk_oauth_access_tokens_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_access_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_oauth_access_tokens_refresh_id_oauth_refresh_tokens_id_fk` FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_tokens`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_client_assertions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_client_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	CONSTRAINT `fk_oauth_client_resources_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_client_resources_resource_id_oauth_resources_identifier_fk` FOREIGN KEY (`resource_id`) REFERENCES `oauth_resources`(`identifier`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`client_id` text NOT NULL UNIQUE,
	`client_secret` text,
	`client_discovery_id` text,
	`disabled` integer,
	`skip_consent` integer,
	`enable_end_session` integer,
	`subject_type` text,
	`scopes` text,
	`client_credentials_scopes` text,
	`user_id` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`backchannel_logout_uri` text,
	`backchannel_logout_session_required` integer,
	`token_endpoint_auth_method` text,
	`application_type` text,
	`jwks` text,
	`jwks_uri` text,
	`grant_types` text,
	`response_types` text,
	`require_pkce` integer,
	`dpop_bound_access_tokens` integer,
	`reference_id` text,
	`metadata` text,
	CONSTRAINT `fk_oauth_clients_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_consents` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`client_id` text NOT NULL,
	`user_id` integer,
	`reference_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_consents_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`),
	CONSTRAINT `fk_oauth_consents_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`client_id` text NOT NULL,
	`session_id` integer,
	`user_id` integer NOT NULL,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` integer NOT NULL,
	`revoked` integer,
	`rotated_at` integer,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` integer,
	`auth_time` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_refresh_tokens_client_id_oauth_clients_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`),
	CONSTRAINT `fk_oauth_refresh_tokens_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`identifier` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`access_token_ttl` integer,
	`refresh_token_ttl` integer,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` integer,
	`disabled` integer,
	`policy_version` integer,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_access_tokens_client_id` ON `oauth_access_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_access_tokens_session_id` ON `oauth_access_tokens` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_access_tokens_user_id` ON `oauth_access_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_access_tokens_authorization_code_id` ON `oauth_access_tokens` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_access_tokens_refresh_id` ON `oauth_access_tokens` (`refresh_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_oauth_client_resources_client_id_resource_id` ON `oauth_client_resources` (`client_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_client_resources_client_id` ON `oauth_client_resources` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_client_resources_resource_id` ON `oauth_client_resources` (`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_clients_user_id` ON `oauth_clients` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_consents_client_id` ON `oauth_consents` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_consents_user_id` ON `oauth_consents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_refresh_tokens_client_id` ON `oauth_refresh_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_refresh_tokens_session_id` ON `oauth_refresh_tokens` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_refresh_tokens_user_id` ON `oauth_refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_refresh_tokens_authorization_code_id` ON `oauth_refresh_tokens` (`authorization_code_id`);