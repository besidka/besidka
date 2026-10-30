CREATE TABLE `legal_notice_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer NOT NULL,
	`notice_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`last_error_code` text,
	`message_id` text,
	`sent_at` integer,
	CONSTRAINT `fk_legal_notice_deliveries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_legal_notice_deliveries_user_notice` ON `legal_notice_deliveries` (`user_id`,`notice_id`);--> statement-breakpoint
CREATE INDEX `idx_legal_notice_deliveries_notice_status` ON `legal_notice_deliveries` (`notice_id`,`status`);