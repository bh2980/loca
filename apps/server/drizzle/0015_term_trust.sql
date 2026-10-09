PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`origin` text DEFAULT 'human' NOT NULL,
	`run_id` text,
	`reviewed` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_terms`("id", "project_id", "source", "target", "note", "status", "origin", "run_id", "reviewed", "updated_at") SELECT "id", "project_id", "source", "target", "note", "status", CASE WHEN "origin" LIKE 'run:%' THEN 'ai' ELSE 'human' END, CASE WHEN "origin" LIKE 'run:%' THEN substr("origin", 5) ELSE NULL END, CASE WHEN "origin" LIKE 'run:%' AND "status" = 'confirmed' THEN 1 ELSE 0 END, "updated_at" FROM `terms`;--> statement-breakpoint
DROP TABLE `terms`;--> statement-breakpoint
ALTER TABLE `__new_terms` RENAME TO `terms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;