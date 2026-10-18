PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`role` text,
	`scope` text DEFAULT '["lines","terms","people","documents","events"]' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tags`("id", "project_id", "name", "color", "role", "scope") SELECT "id", "project_id", "name", "color", "role", "scope" FROM `tags`;--> statement-breakpoint
DROP TABLE `tags`;--> statement-breakpoint
ALTER TABLE `__new_tags` RENAME TO `tags`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `graph_views` ADD `origin` text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE `graph_views` ADD `request` text;--> statement-breakpoint
ALTER TABLE `graph_views` ADD `reasons` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `graph_views` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `graph_views` SET `updated_at` = `created_at`;