ALTER TABLE `chats` ADD `memory_excluded` integer;--> statement-breakpoint
CREATE INDEX `idx_chats_memory_due` ON `chats` (`user_id`,`activity_at`) WHERE memory_excluded IS NOT 1 AND (
        (project_id IS NULL AND (
          memory_extracted_at IS NULL OR memory_extracted_at < activity_at
        ))
        OR (project_id IS NOT NULL AND (
          project_memory_summary_updated_at IS NULL
          OR project_memory_summary_updated_at < activity_at
        ))
      );