ALTER TABLE `user_settings` ADD `terms_accepted_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `terms_version` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `age_confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `sensitive_content_consent_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `sensitive_content_consent_version` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `sensitive_content_consent_withdrawn_at` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `provider_transfer_consents` text;