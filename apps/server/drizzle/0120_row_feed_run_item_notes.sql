-- A line's row shows only what its latest run noted (run_items data.issues) and which run that was (src/services/
-- unit-rows.ts): a run item moving through a run (state, node, error, the rest of its data) changes the line's run
-- history (line extras) and not its row. 0112 noted the line for all of them, so every screen holding lines read them
-- again several times per run. Now the line is noted when its issues change (or an item is added or removed), and
-- the line extras have their own name. A migration that rebuilds run_items must make these again.
DROP TRIGGER IF EXISTS `feed_run_items_update`;--> statement-breakpoint
CREATE TRIGGER `feed_run_items_update` AFTER UPDATE OF `data` ON `run_items` WHEN json_extract(NEW.`data`, '$.issues') IS NOT json_extract(OLD.`data`, '$.issues') AND (SELECT `subject` FROM `runs` WHERE `id` = NEW.`run_id`) = 'lines' BEGIN SELECT row_changed('units', NEW.`subject_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_line_extras_run_item_insert` AFTER INSERT ON `run_items` WHEN (SELECT `subject` FROM `runs` WHERE `id` = NEW.`run_id`) = 'lines' BEGIN SELECT row_changed('lineExtras', NEW.`subject_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_line_extras_run_item_update` AFTER UPDATE OF `data`, `state`, `node_id`, `error` ON `run_items` WHEN (SELECT `subject` FROM `runs` WHERE `id` = NEW.`run_id`) = 'lines' BEGIN SELECT row_changed('lineExtras', NEW.`subject_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_line_extras_run_item_delete` AFTER DELETE ON `run_items` WHEN (SELECT `subject` FROM `runs` WHERE `id` = OLD.`run_id`) = 'lines' BEGIN SELECT row_changed('lineExtras', OLD.`subject_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = OLD.`run_id`)); END;
