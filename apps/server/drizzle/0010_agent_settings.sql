ALTER TABLE `connections` ADD `options` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `agent_settings` text DEFAULT '{"disabledTools":[]}' NOT NULL;