ALTER TABLE `skills` ADD `slash_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skills_user_slash_name` ON `skills` (`user_id`,`slash_name`);