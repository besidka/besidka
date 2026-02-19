ALTER TABLE `files` ADD `source` text DEFAULT 'upload' NOT NULL;
--> statement-breakpoint
ALTER TABLE `files` ADD `origin_provider` text;
--> statement-breakpoint
ALTER TABLE `files` ADD `origin_message_id` integer REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null;
