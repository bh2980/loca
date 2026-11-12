-- The old 길 따라 번역 state (picks, rounds, seam checks) and the one-time steps of app_settings went with their code.
-- agent_settings has no disabledTools any more, so its default becomes '{}': SQLite cannot change a default in place and
-- recreating `projects` would cascade into every table under it, so the column is replaced by a new one.
ALTER TABLE `projects` DROP COLUMN `route_picks`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `join_checks`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `route_state`;--> statement-breakpoint
ALTER TABLE `projects` ADD `agent_settings_next` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `agent_settings_next` = json_remove(`agent_settings`, '$.disabledTools');--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `agent_settings`;--> statement-breakpoint
ALTER TABLE `projects` RENAME COLUMN `agent_settings_next` TO `agent_settings`;--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `done`;
