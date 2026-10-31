-- A term's scope becomes the kinds of line it applies to: all → every kind, ui → [ui], dialogue → [dialogue, document].
-- The table is rebuilt: its own trigger (terms_tags_gone, 0043) goes with the old table and is made again, and the triggers on
-- units that write terms (0094) go first and come back after.
DROP TRIGGER IF EXISTS terms_usage_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS terms_usage_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS terms_usage_update;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`origin` text DEFAULT 'human' NOT NULL,
	`lines` integer,
	`examples` text DEFAULT '[]' NOT NULL,
	`run_id` text,
	`status_by` text DEFAULT 'human' NOT NULL,
	`scope` text DEFAULT '["ui","dialogue","document"]' NOT NULL,
	`match_case` integer DEFAULT false NOT NULL,
	`target_candidates` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_terms`("id", "project_id", "source", "target", "note", "status", "origin", "lines", "examples", "run_id", "status_by", "scope", "match_case", "target_candidates", "updated_at") SELECT "id", "project_id", "source", "target", "note", "status", "origin", "lines", "examples", "run_id", "status_by", CASE "scope" WHEN 'ui' THEN '["ui"]' WHEN 'dialogue' THEN '["dialogue","document"]' ELSE '["ui","dialogue","document"]' END, "match_case", "target_candidates", "updated_at" FROM `terms`;--> statement-breakpoint
DROP TABLE `terms`;--> statement-breakpoint
ALTER TABLE `__new_terms` RENAME TO `terms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `terms_source` ON `terms` (`project_id`,lower("source"));--> statement-breakpoint
CREATE TRIGGER terms_usage_insert AFTER INSERT ON units BEGIN
  UPDATE terms SET lines = NULL, examples = '[]' WHERE project_id = NEW.project_id AND (lines IS NOT NULL OR examples <> '[]');
END;
--> statement-breakpoint
CREATE TRIGGER terms_usage_delete AFTER DELETE ON units BEGIN
  UPDATE terms SET lines = NULL, examples = '[]' WHERE project_id = OLD.project_id AND (lines IS NOT NULL OR examples <> '[]');
END;
--> statement-breakpoint
CREATE TRIGGER terms_usage_update AFTER UPDATE OF source, speaker, key, seq, project_id ON units
WHEN OLD.source IS NOT NEW.source OR OLD.speaker IS NOT NEW.speaker OR OLD.key IS NOT NEW.key OR OLD.seq IS NOT NEW.seq OR OLD.project_id IS NOT NEW.project_id
BEGIN
  UPDATE terms SET lines = NULL, examples = '[]' WHERE project_id IN (OLD.project_id, NEW.project_id) AND (lines IS NOT NULL OR examples <> '[]');
END;
--> statement-breakpoint
CREATE TRIGGER `terms_tags_gone` AFTER DELETE ON `terms` BEGIN DELETE FROM `knowledge_tags` WHERE `kind` = 'terms' AND `item_id` = OLD.`id`; END;
