ALTER TABLE `terms` ADD `mode` text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `terms` ADD `alternatives` text DEFAULT '[]' NOT NULL;