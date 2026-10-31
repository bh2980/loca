-- The row feed (src/feed.ts): every change to a row the browser keeps in a collection is reported by the database
-- itself, so no write path can forget it. row_changed(collection, row id, op, project id) is a JS function
-- (registerMigrationFunctions, db/index.ts); it only notes the row, the feed reads it again when it sends.
-- A migration that rebuilds one of these tables must make its triggers again.
CREATE TRIGGER `feed_terms_insert` AFTER INSERT ON `terms` BEGIN SELECT row_changed('terms', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_terms_update` AFTER UPDATE ON `terms` BEGIN SELECT row_changed('terms', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_terms_delete` AFTER DELETE ON `terms` BEGIN SELECT row_changed('terms', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
-- A tag put on or taken off an item changes that item's row (its tags). Its project is the item's.
CREATE TRIGGER `feed_knowledge_tags_insert` AFTER INSERT ON `knowledge_tags` WHEN NEW.`kind` = 'terms' BEGIN SELECT row_changed('terms', NEW.`item_id`, 'upsert', (SELECT `project_id` FROM `terms` WHERE `id` = NEW.`item_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_knowledge_tags_update` AFTER UPDATE ON `knowledge_tags` WHEN NEW.`kind` = 'terms' BEGIN SELECT row_changed('terms', NEW.`item_id`, 'upsert', (SELECT `project_id` FROM `terms` WHERE `id` = NEW.`item_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_knowledge_tags_delete` AFTER DELETE ON `knowledge_tags` WHEN OLD.`kind` = 'terms' BEGIN SELECT row_changed('terms', OLD.`item_id`, 'upsert', (SELECT `project_id` FROM `terms` WHERE `id` = OLD.`item_id`)); END;
