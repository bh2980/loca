-- The row feed (0106) for lines: a line's row (src/services/unit-rows.ts) changes with the line itself, its tags,
-- its AI candidates (origin, 제안 대기) and the latest run's notes on it. The browser holds only the lines it shows.
-- A migration that rebuilds one of these tables must make its triggers again.
CREATE TRIGGER `feed_units_insert` AFTER INSERT ON `units` BEGIN SELECT row_changed('units', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_units_update` AFTER UPDATE ON `units` BEGIN SELECT row_changed('units', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_units_delete` AFTER DELETE ON `units` BEGIN SELECT row_changed('units', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_unit_tags_insert` AFTER INSERT ON `unit_tags` BEGIN SELECT row_changed('units', NEW.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = NEW.`unit_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_unit_tags_delete` AFTER DELETE ON `unit_tags` BEGIN SELECT row_changed('units', OLD.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = OLD.`unit_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_candidates_insert` AFTER INSERT ON `candidates` BEGIN SELECT row_changed('units', NEW.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = NEW.`unit_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_candidates_update` AFTER UPDATE OF `state` ON `candidates` BEGIN SELECT row_changed('units', NEW.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = NEW.`unit_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_candidates_delete` AFTER DELETE ON `candidates` BEGIN SELECT row_changed('units', OLD.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = OLD.`unit_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_run_items_insert` AFTER INSERT ON `run_items` WHEN (SELECT `subject` FROM `runs` WHERE `id` = NEW.`run_id`) = 'lines' BEGIN SELECT row_changed('units', NEW.`subject_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_run_items_update` AFTER UPDATE OF `data` ON `run_items` WHEN (SELECT `subject` FROM `runs` WHERE `id` = NEW.`run_id`) = 'lines' BEGIN SELECT row_changed('units', NEW.`subject_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_run_items_delete` AFTER DELETE ON `run_items` WHEN (SELECT `subject` FROM `runs` WHERE `id` = OLD.`run_id`) = 'lines' BEGIN SELECT row_changed('units', OLD.`subject_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = OLD.`run_id`)); END;
