-- A run's items are lines or terms (runs.subject): run_items.unit_id becomes subject_id without the
-- foreign key to units (deleting a line or a term cancels its open items in the app), and run_steps
-- name their items the same way.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_run_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`node_id` text NOT NULL,
	`state` text NOT NULL,
	`visits` text NOT NULL,
	`data` text NOT NULL,
	`error` text,
	`plan` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_run_items` (`id`, `run_id`, `subject_id`, `node_id`, `state`, `visits`, `data`, `error`, `plan`, `updated_at`) SELECT `id`, `run_id`, `unit_id`, `node_id`, `state`, `visits`, `data`, `error`, `plan`, `updated_at` FROM `run_items`;--> statement-breakpoint
DROP TABLE `run_items`;--> statement-breakpoint
ALTER TABLE `__new_run_items` RENAME TO `run_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `run_items_run` ON `run_items` (`run_id`,`state`,`node_id`);--> statement-breakpoint
CREATE INDEX `run_items_subject` ON `run_items` (`subject_id`);--> statement-breakpoint
ALTER TABLE `run_steps` RENAME COLUMN `unit_ids` TO `subject_ids`;--> statement-breakpoint
ALTER TABLE `run_steps` RENAME COLUMN `returned_lines` TO `returned_items`;--> statement-breakpoint
ALTER TABLE `runs` ADD `subject` text DEFAULT 'lines' NOT NULL;
