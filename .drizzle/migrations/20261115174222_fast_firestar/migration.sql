CREATE TABLE `project_skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`skill_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`level` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_skills_project_skill` ON `project_skills` (`project_id`,`skill_id`);--> statement-breakpoint
CREATE INDEX `idx_project_skills_user` ON `project_skills` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_project_skills_skill` ON `project_skills` (`skill_id`);