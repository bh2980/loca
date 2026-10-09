CREATE TABLE `analysis_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text,
	`model` text,
	`status` text NOT NULL,
	`parts_done` integer DEFAULT 0 NOT NULL,
	`parts_total` integer DEFAULT 1 NOT NULL,
	`usage` text,
	`result` text,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analysis_jobs_project` ON `analysis_jobs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `speech_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_name` text NOT NULL,
	`to_name` text NOT NULL,
	`level` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`start_key` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`origin` text DEFAULT 'human' NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`job_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `speech_rules_pair` ON `speech_rules` (`project_id`,`from_name`,`to_name`);--> statement-breakpoint
CREATE TABLE `story_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`cause` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`participants` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`origin` text DEFAULT 'human' NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`job_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `characters` ADD `speech` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `characters` ADD `player` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `characters` ADD `status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `characters` ADD `origin` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `characters` ADD `evidence` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `characters` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `origin` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `evidence` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `relationships` ADD `changes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `origin` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `evidence` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `units` ADD `listener` text;--> statement-breakpoint
ALTER TABLE `units` ADD `listener_origin` text;--> statement-breakpoint
ALTER TABLE `units` ADD `listener_confidence` real;