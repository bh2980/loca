DROP TABLE `analysis_jobs`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `job_id`;--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `job_id`;--> statement-breakpoint
ALTER TABLE `relationships` DROP COLUMN `job_id`;--> statement-breakpoint
ALTER TABLE `speech_rules` DROP COLUMN `job_id`;--> statement-breakpoint
ALTER TABLE `story_events` DROP COLUMN `job_id`;--> statement-breakpoint
ALTER TABLE `terms` DROP COLUMN `job_id`;--> statement-breakpoint
UPDATE `ai_calls` SET `kind` = 'whole' WHERE `kind` = 'analysis';