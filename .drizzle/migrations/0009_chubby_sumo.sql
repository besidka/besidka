PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_image_transform_usage_monthly` (
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`month_key` text PRIMARY KEY NOT NULL,
	`transforms_used` integer DEFAULT 0 NOT NULL,
	`transforms_limit` integer DEFAULT 1000 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_image_transform_usage_monthly`("created_at", "updated_at", "month_key", "transforms_used", "transforms_limit") SELECT "created_at", "updated_at", "month_key", "transforms_used", "transforms_limit" FROM `image_transform_usage_monthly`;--> statement-breakpoint
DROP TABLE `image_transform_usage_monthly`;--> statement-breakpoint
ALTER TABLE `__new_image_transform_usage_monthly` RENAME TO `image_transform_usage_monthly`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
