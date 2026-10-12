PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_graph_layouts` (
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`section` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`data` text,
	`error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `scope`, `section`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_graph_layouts`("project_id", "scope", "section", "status", "data", "error", "updated_at") SELECT "project_id", "scope", '', "status", "data", "error", "updated_at" FROM `graph_layouts`;--> statement-breakpoint
DROP TABLE `graph_layouts`;--> statement-breakpoint
ALTER TABLE `__new_graph_layouts` RENAME TO `graph_layouts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;