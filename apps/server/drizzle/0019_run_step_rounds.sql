ALTER TABLE `run_steps` ADD `returned_lines` integer;--> statement-breakpoint
ALTER TABLE `run_steps` ADD `round` integer DEFAULT 0 NOT NULL;