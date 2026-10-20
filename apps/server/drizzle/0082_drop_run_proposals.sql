DELETE FROM `proposals` WHERE `source` = 'run';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`model` text,
	`source` text NOT NULL,
	`tool` text NOT NULL,
	`input` text NOT NULL,
	`undo` text,
	`undone_at` integer,
	`report` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`reported_at` integer,
	`decided_by` text,
	`review` text,
	`reason` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_proposals`("id", "project_id", "session_id", "model", "source", "tool", "input", "undo", "undone_at", "report", "status", "result", "created_at", "decided_at", "reported_at", "decided_by", "review", "reason") SELECT "id", "project_id", "session_id", "model", "source", "tool", "input", "undo", "undone_at", "report", "status", "result", "created_at", "decided_at", "reported_at", "decided_by", "review", "reason" FROM `proposals`;--> statement-breakpoint
DROP TABLE `proposals`;--> statement-breakpoint
ALTER TABLE `__new_proposals` RENAME TO `proposals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `proposals_project` ON `proposals` (`project_id`,`status`);