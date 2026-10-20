ALTER TABLE `graph_edges` ADD `origin` text DEFAULT 'import' NOT NULL;--> statement-breakpoint
ALTER TABLE `graph_nodes` ADD `origin` text DEFAULT 'import' NOT NULL;--> statement-breakpoint
-- Lines added in the app were stored as kind 'line', which the graph does not draw as a line card.
UPDATE `graph_nodes` SET `kind` = 'script', `origin` = 'human' WHERE `kind` = 'line' AND json_extract(`meta`, '$.manualSourceEntry') = 1;
