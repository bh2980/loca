ALTER TABLE `characters` ADD `reviewed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `reviewed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `reviewed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `speech_rules` ADD `reviewed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `story_events` ADD `reviewed` integer DEFAULT false NOT NULL;