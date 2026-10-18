ALTER TABLE `proposals` ADD `run_id` text REFERENCES runs(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `proposals` ADD `node_id` text;
