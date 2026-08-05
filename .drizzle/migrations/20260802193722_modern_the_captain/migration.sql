CREATE TABLE `two_factors` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` integer NOT NULL,
	`verified` integer,
	`failed_verification_count` integer,
	`locked_until` integer,
	CONSTRAINT `fk_two_factors_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `users` ADD `two_factor_enabled` integer;--> statement-breakpoint
CREATE INDEX `idx_two_factors_user_id` ON `two_factors` (`user_id`);