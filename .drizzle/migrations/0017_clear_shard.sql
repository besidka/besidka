ALTER TABLE `messages` ADD `public_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_public_id_unique` ON `messages` (`public_id`);