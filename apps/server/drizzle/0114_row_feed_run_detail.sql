-- The row feed (0106) for a run's items (src/services/run-detail.ts runItemRows): each item is named by id when it
-- changes, and the browser reads again the items it shows. A run's progress (counts by node, usage, retries) is
-- read again when the run's row changes: a step (a model call) and an item's path or retry note the run too.
-- A migration that rebuilds one of these tables must make its triggers again.
CREATE TRIGGER `feed_run_items_row_insert` AFTER INSERT ON `run_items` BEGIN SELECT row_changed('runItems', NEW.`id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_run_items_row_update` AFTER UPDATE ON `run_items` BEGIN SELECT row_changed('runItems', NEW.`id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_run_items_row_delete` AFTER DELETE ON `run_items` BEGIN SELECT row_changed('runItems', OLD.`id`, 'delete', (SELECT `project_id` FROM `runs` WHERE `id` = OLD.`run_id`)); END;--> statement-breakpoint
DROP TRIGGER IF EXISTS `feed_runs_item_update`;--> statement-breakpoint
CREATE TRIGGER `feed_runs_item_update` AFTER UPDATE OF `state`, `node_id`, `data` ON `run_items` BEGIN SELECT row_changed('runs', NEW.`run_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_runs_step_insert` AFTER INSERT ON `run_steps` BEGIN SELECT row_changed('runs', NEW.`run_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;
