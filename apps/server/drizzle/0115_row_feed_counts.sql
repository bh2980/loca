-- The row feed (0106) for how many lines each status has and how many lines and items each tag is on
-- (src/services/count-rows.ts): a status's count changes when a line moves into or out of it, a tag's when it is put
-- on or taken off a line or an item. A migration that rebuilds one of these tables must make its triggers again.
CREATE TRIGGER `feed_status_counts_unit_insert` AFTER INSERT ON `units` BEGIN SELECT row_changed('statusCounts', NEW.`status_id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_status_counts_unit_delete` AFTER DELETE ON `units` BEGIN SELECT row_changed('statusCounts', OLD.`status_id`, 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_status_counts_unit_update` AFTER UPDATE OF `status_id` ON `units` WHEN OLD.`status_id` != NEW.`status_id` BEGIN SELECT row_changed('statusCounts', NEW.`status_id`, 'upsert', NEW.`project_id`); SELECT row_changed('statusCounts', OLD.`status_id`, 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_status_counts_status_insert` AFTER INSERT ON `statuses` BEGIN SELECT row_changed('statusCounts', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_status_counts_status_delete` AFTER DELETE ON `statuses` BEGIN SELECT row_changed('statusCounts', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_tag_counts_unit_insert` AFTER INSERT ON `unit_tags` BEGIN SELECT row_changed('tagCounts', NEW.`tag_id`, 'upsert', (SELECT `project_id` FROM `tags` WHERE `id` = NEW.`tag_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_tag_counts_unit_delete` AFTER DELETE ON `unit_tags` BEGIN SELECT row_changed('tagCounts', OLD.`tag_id`, 'upsert', (SELECT `project_id` FROM `tags` WHERE `id` = OLD.`tag_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_tag_counts_item_insert` AFTER INSERT ON `knowledge_tags` BEGIN SELECT row_changed('tagCounts', NEW.`tag_id`, 'upsert', (SELECT `project_id` FROM `tags` WHERE `id` = NEW.`tag_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_tag_counts_item_delete` AFTER DELETE ON `knowledge_tags` BEGIN SELECT row_changed('tagCounts', OLD.`tag_id`, 'upsert', (SELECT `project_id` FROM `tags` WHERE `id` = OLD.`tag_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_tag_counts_tag_insert` AFTER INSERT ON `tags` BEGIN SELECT row_changed('tagCounts', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_tag_counts_tag_delete` AFTER DELETE ON `tags` BEGIN SELECT row_changed('tagCounts', OLD.`id`, 'delete', OLD.`project_id`); END;
