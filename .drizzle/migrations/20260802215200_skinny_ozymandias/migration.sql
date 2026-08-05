CREATE TABLE `passkeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` integer NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`aaguid` text,
	CONSTRAINT `fk_passkeys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_passkeys_user_id` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_passkeys_credential_id` ON `passkeys` (`credential_id`);