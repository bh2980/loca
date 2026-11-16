ALTER TABLE `speech_rules` ADD `sometimes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `speech_rules` ADD `never` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `speech_rules` ADD `examples` text DEFAULT '[]' NOT NULL;