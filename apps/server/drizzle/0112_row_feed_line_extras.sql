-- A line's run history (the line detail's 실행 기록: state, node, error, result) is read again when any of these
-- change, not only its result (0108 noted run_items data alone). A migration that rebuilds run_items must make it again.
DROP TRIGGER IF EXISTS `feed_run_items_update`;--> statement-breakpoint
CREATE TRIGGER `feed_run_items_update` AFTER UPDATE OF `data`, `state`, `node_id`, `error` ON `run_items` WHEN (SELECT `subject` FROM `runs` WHERE `id` = NEW.`run_id`) = 'lines' BEGIN SELECT row_changed('units', NEW.`subject_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;
