ALTER TABLE `terms` ADD `lines` integer;--> statement-breakpoint
ALTER TABLE `terms` ADD `examples` text DEFAULT '[]' NOT NULL;