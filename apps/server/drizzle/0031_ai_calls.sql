CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`ref_id` text,
	`label` text NOT NULL,
	`profile_id` text,
	`connection_kind` text,
	`model` text,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`input_tokens` integer,
	`cached_input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_calls_project_started` ON `ai_calls` (`project_id`,`started_at`);