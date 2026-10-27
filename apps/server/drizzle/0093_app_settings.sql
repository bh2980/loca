CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY DEFAULT 'app' NOT NULL,
	`defaults` text DEFAULT '{}' NOT NULL,
	`done` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `project_id` text REFERENCES projects(id) ON DELETE cascade;