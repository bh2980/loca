-- Every table a collection's reader reads notes that collection's row (src/feed.ts READERS; feed-readers.test.ts
-- states which tables each reads and checks the triggers are there). These were read with no trigger of their own:
-- the browser read such rows again by watching other parts of an event. A migration that rebuilds candidates, units,
-- terms, runs, ai_calls, knowledge_tags or graph_edges must make these again.
-- A line's extras list its candidates whole (0112 noted only the line's row for them).
CREATE TRIGGER `feed_line_extras_candidate_insert` AFTER INSERT ON `candidates` BEGIN SELECT row_changed('lineExtras', NEW.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = NEW.`unit_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_line_extras_candidate_update` AFTER UPDATE ON `candidates` BEGIN SELECT row_changed('lineExtras', NEW.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = NEW.`unit_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_line_extras_candidate_delete` AFTER DELETE ON `candidates` BEGIN SELECT row_changed('lineExtras', OLD.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = OLD.`unit_id`)); END;--> statement-breakpoint
-- ...and go with their line.
CREATE TRIGGER `feed_line_extras_unit_delete` AFTER DELETE ON `units` BEGIN SELECT row_changed('lineExtras', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
-- A term's run item carries the term's words.
CREATE TRIGGER `feed_run_items_term_update` AFTER UPDATE OF `source`, `target` ON `terms` WHEN OLD.`source` IS NOT NEW.`source` OR OLD.`target` IS NOT NEW.`target` BEGIN SELECT row_changed('runItems', `id`, 'upsert', NEW.`project_id`) FROM `run_items` WHERE `subject_id` = NEW.`id`; END;--> statement-breakpoint
-- A run item says which model its retry goes to and how many tries the node allows, from its run's models and definition (a continue on other models changes both).
CREATE TRIGGER `feed_run_items_run_update` AFTER UPDATE OF `definition`, `models` ON `runs` WHEN OLD.`definition` IS NOT NEW.`definition` OR OLD.`models` IS NOT NEW.`models` BEGIN SELECT row_changed('runItems', `id`, 'upsert', NEW.`project_id`) FROM `run_items` WHERE `run_id` = NEW.`id`; END;--> statement-breakpoint
-- A run's and a conversation's rows count their calls: one deleted counts too (0116 and 0119 noted the insert and the tokens).
CREATE TRIGGER `feed_runs_call_delete` AFTER DELETE ON `ai_calls` WHEN OLD.`ref_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `runs` WHERE `id` = OLD.`ref_id`) BEGIN SELECT row_changed('runs', OLD.`ref_id`, 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_chat_sessions_call_delete` AFTER DELETE ON `ai_calls` WHEN OLD.`ref_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `chat_sessions` WHERE `id` = OLD.`ref_id`) BEGIN SELECT row_changed('chatSessions', OLD.`ref_id`, 'upsert', OLD.`project_id`); END;--> statement-breakpoint
-- The event flow reads its events' tags with their notes, and the graph's edges with their labels.
CREATE TRIGGER `feed_events_tag_update` AFTER UPDATE ON `knowledge_tags` WHEN NEW.`kind` = 'events' BEGIN SELECT row_changed('events', '*', 'upsert', (SELECT `project_id` FROM `story_events` WHERE `id` = NEW.`item_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_graph_edge_update` AFTER UPDATE ON `graph_edges` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;
