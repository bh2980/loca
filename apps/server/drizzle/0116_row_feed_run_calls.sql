-- A run's row also carries its model calls and tokens from the AI log (src/services/run-rows.ts): a call logged or
-- finished for a run notes that run. A migration that rebuilds ai_calls must make these again.
CREATE TRIGGER `feed_runs_call_insert` AFTER INSERT ON `ai_calls` WHEN NEW.`ref_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `runs` WHERE `id` = NEW.`ref_id`) BEGIN SELECT row_changed('runs', NEW.`ref_id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_runs_call_update` AFTER UPDATE OF `input_tokens`, `output_tokens` ON `ai_calls` WHEN NEW.`ref_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `runs` WHERE `id` = NEW.`ref_id`) BEGIN SELECT row_changed('runs', NEW.`ref_id`, 'upsert', NEW.`project_id`); END;
