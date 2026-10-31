-- The row feed (0106) for a project's saved graph views (their list), its conversations (with their model use from
-- the AI log) and the AI log itself, named by id (the browser holds the calls a list shows; a model test has no
-- project and is noted under 'app'). A migration that rebuilds one of these tables must make its triggers again.
CREATE TRIGGER `feed_graph_views_insert` AFTER INSERT ON `graph_views` BEGIN SELECT row_changed('graphViews', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_graph_views_update` AFTER UPDATE ON `graph_views` BEGIN SELECT row_changed('graphViews', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_graph_views_delete` AFTER DELETE ON `graph_views` BEGIN SELECT row_changed('graphViews', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_chat_sessions_insert` AFTER INSERT ON `chat_sessions` BEGIN SELECT row_changed('chatSessions', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_chat_sessions_update` AFTER UPDATE ON `chat_sessions` BEGIN SELECT row_changed('chatSessions', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_chat_sessions_delete` AFTER DELETE ON `chat_sessions` BEGIN SELECT row_changed('chatSessions', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_chat_sessions_call_insert` AFTER INSERT ON `ai_calls` WHEN NEW.`ref_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `chat_sessions` WHERE `id` = NEW.`ref_id`) BEGIN SELECT row_changed('chatSessions', NEW.`ref_id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_chat_sessions_call_update` AFTER UPDATE OF `input_tokens`, `output_tokens` ON `ai_calls` WHEN NEW.`ref_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `chat_sessions` WHERE `id` = NEW.`ref_id`) BEGIN SELECT row_changed('chatSessions', NEW.`ref_id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_ai_calls_insert` AFTER INSERT ON `ai_calls` BEGIN SELECT row_changed('aiCalls', NEW.`id`, 'upsert', coalesce(NEW.`project_id`, 'app')); END;--> statement-breakpoint
CREATE TRIGGER `feed_ai_calls_update` AFTER UPDATE ON `ai_calls` BEGIN SELECT row_changed('aiCalls', NEW.`id`, 'upsert', coalesce(NEW.`project_id`, 'app')); END;--> statement-breakpoint
CREATE TRIGGER `feed_ai_calls_delete` AFTER DELETE ON `ai_calls` BEGIN SELECT row_changed('aiCalls', OLD.`id`, 'delete', coalesce(OLD.`project_id`, 'app')); END;
