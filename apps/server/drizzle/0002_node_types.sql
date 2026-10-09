ALTER TABLE `graph_nodes` ADD `type` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `node_types` text DEFAULT '{}' NOT NULL;