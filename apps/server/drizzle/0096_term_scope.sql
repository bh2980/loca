ALTER TABLE `terms` ADD `scope` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `terms` ADD `match_case` integer DEFAULT 0 NOT NULL;