ALTER TABLE `push_subscriptions` ADD `last_seen_at` integer;--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_last_seen_at` ON `push_subscriptions` (`last_seen_at`);--> statement-breakpoint
UPDATE `push_subscriptions` SET `last_seen_at` = CAST(unixepoch() AS INTEGER) WHERE `last_seen_at` IS NULL;