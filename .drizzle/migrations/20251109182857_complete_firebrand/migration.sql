ALTER TABLE `messages` ADD `reasoning` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `ip_address`;