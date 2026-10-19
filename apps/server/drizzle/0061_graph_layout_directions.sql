CREATE TABLE `__new_graph_layouts` (
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`section` text NOT NULL DEFAULT '',
	`direction` text NOT NULL DEFAULT 'vertical',
	`status` text NOT NULL,
	`data` text,
	`error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `scope`, `section`, `direction`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_graph_layouts` (`project_id`, `scope`, `section`, `direction`, `status`, `data`, `error`, `updated_at`)
SELECT `project_id`, `scope`, `section`, 'vertical', `status`, `data`, `error`, `updated_at` FROM `graph_layouts`;
--> statement-breakpoint
DROP TABLE `graph_layouts`;
--> statement-breakpoint
ALTER TABLE `__new_graph_layouts` RENAME TO `graph_layouts`;
