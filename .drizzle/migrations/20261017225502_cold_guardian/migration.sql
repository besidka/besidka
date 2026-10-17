CREATE TABLE `user_activation_events` (
	`user_id` integer NOT NULL,
	`event` text NOT NULL,
	`provider` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `user_activation_events_pk` PRIMARY KEY(`user_id`, `event`),
	CONSTRAINT `fk_user_activation_events_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user_attribution` (
	`user_id` integer PRIMARY KEY,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`utm_content` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_user_attribution_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
