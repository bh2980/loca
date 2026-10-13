ALTER TABLE `characters` ADD `status_by` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `status_by` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `ai_confirm` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `status_by` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `speech_rules` ADD `status_by` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `statuses` ADD `human_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `story_events` ADD `status_by` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `terms` ADD `status_by` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `units` ADD `status_by` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `units` ADD `status_run_id` text;--> statement-breakpoint
-- Who set the status, from what was inferred before: an AI item no person edited or confirmed.
UPDATE `characters` SET `status_by` = 'ai' WHERE `origin` = 'ai' AND `reviewed` = 0;--> statement-breakpoint
UPDATE `documents` SET `status_by` = 'ai' WHERE `origin` = 'ai' AND `reviewed` = 0;--> statement-breakpoint
UPDATE `relationships` SET `status_by` = 'ai' WHERE `origin` = 'ai' AND `reviewed` = 0;--> statement-breakpoint
UPDATE `speech_rules` SET `status_by` = 'ai' WHERE `origin` = 'ai' AND `reviewed` = 0;--> statement-breakpoint
UPDATE `story_events` SET `status_by` = 'ai' WHERE `origin` = 'ai' AND `reviewed` = 0;--> statement-breakpoint
UPDATE `terms` SET `status_by` = 'ai' WHERE `origin` = 'ai' AND `reviewed` = 0;--> statement-breakpoint
-- A line whose representative translation came from a run (and no person's version replaced it) had its status set by that run.
UPDATE `units` SET `status_by` = 'ai', `status_run_id` = (SELECT `run_id` FROM `candidates` WHERE `candidates`.`id` = `units`.`candidate_id`)
WHERE `candidate_id` IN (SELECT `id` FROM `candidates` WHERE `run_id` IS NOT NULL AND `origin` IN ('ai', 'tool'));
