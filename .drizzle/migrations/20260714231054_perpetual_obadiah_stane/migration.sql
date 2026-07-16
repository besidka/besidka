CREATE TABLE `image_generation_locks` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` integer PRIMARY KEY,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
