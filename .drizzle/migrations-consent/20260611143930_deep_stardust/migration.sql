CREATE TABLE `consent_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`revision` integer NOT NULL,
	`granted` text NOT NULL,
	`denied` text NOT NULL,
	`changed` text NOT NULL,
	`decision` text NOT NULL,
	`consistent` integer DEFAULT false NOT NULL,
	`country` text
);
--> statement-breakpoint
CREATE INDEX `idx_consent_receipts_created_at` ON `consent_receipts` (`created_at`);