-- The row feed (0106) for workflow runs (src/services/run-rows.ts): a run's row changes with the run itself and with
-- the state of its items (its lines done, failed, running…).
-- A migration that rebuilds one of these tables must make its triggers again.
CREATE TRIGGER `feed_runs_insert` AFTER INSERT ON `runs` BEGIN SELECT row_changed('runs', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_runs_update` AFTER UPDATE ON `runs` BEGIN SELECT row_changed('runs', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_runs_delete` AFTER DELETE ON `runs` BEGIN SELECT row_changed('runs', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_runs_item_insert` AFTER INSERT ON `run_items` BEGIN SELECT row_changed('runs', NEW.`run_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_runs_item_update` AFTER UPDATE OF `state` ON `run_items` BEGIN SELECT row_changed('runs', NEW.`run_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = NEW.`run_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_runs_item_delete` AFTER DELETE ON `run_items` BEGIN SELECT row_changed('runs', OLD.`run_id`, 'upsert', (SELECT `project_id` FROM `runs` WHERE `id` = OLD.`run_id`)); END;
