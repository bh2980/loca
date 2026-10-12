CREATE TABLE `term_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text,
	`status` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`usage` text,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `term_jobs_project` ON `term_jobs` (`project_id`,`created_at`);