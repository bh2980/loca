ALTER TABLE `connections` ADD `header_template` text;--> statement-breakpoint
ALTER TABLE `terms` ADD `status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `terms` ADD `origin` text;