CREATE TABLE `source_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text,
	`via` text NOT NULL,
	`summary` text NOT NULL,
	`undo_id` text,
	`undone_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_imports_project` ON `source_imports` (`project_id`,`created_at`);--> statement-breakpoint
-- The 원문 넣기 log is a collection of its own (feed.ts READERS sourceImports) under the units topic (db/topics.ts).
CREATE TRIGGER `feed_source_imports_insert` AFTER INSERT ON `source_imports` BEGIN SELECT row_changed('sourceImports', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_source_imports_update` AFTER UPDATE ON `source_imports` BEGIN SELECT row_changed('sourceImports', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_source_imports_delete` AFTER DELETE ON `source_imports` BEGIN SELECT row_changed('sourceImports', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `topic_source_imports_insert` AFTER INSERT ON `source_imports` BEGIN SELECT topic_changed('units', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `topic_source_imports_update` AFTER UPDATE ON `source_imports` BEGIN SELECT topic_changed('units', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `topic_source_imports_delete` AFTER DELETE ON `source_imports` BEGIN SELECT topic_changed('units', OLD.`project_id`); END;
