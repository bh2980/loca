-- The row feed (0106) for scenes, documents and UI groups with their progress (src/services/group-rows.ts): a group's
-- row changes with the group itself, with what its lines count by (status, 번역 제외, 청자 모름) and with the
-- project's rules those counts read (format and exclusion rules, source language).
-- A migration that rebuilds one of these tables must make its triggers again.
CREATE TRIGGER `feed_groups_insert` AFTER INSERT ON `groups` BEGIN SELECT row_changed('groups', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_groups_update` AFTER UPDATE ON `groups` BEGIN SELECT row_changed('groups', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_groups_delete` AFTER DELETE ON `groups` BEGIN SELECT row_changed('groups', OLD.`id`, 'delete', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_groups_unit_insert` AFTER INSERT ON `units` BEGIN SELECT row_changed('groups', NEW.`group_id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_groups_unit_delete` AFTER DELETE ON `units` BEGIN SELECT row_changed('groups', OLD.`group_id`, 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_groups_unit_update` AFTER UPDATE OF `group_id`, `status_id`, `source`, `translate`, `kind`, `speaker`, `listener`, `listener_origin`, `listener_confidence` ON `units` BEGIN SELECT row_changed('groups', NEW.`group_id`, 'upsert', NEW.`project_id`); SELECT row_changed('groups', OLD.`group_id`, 'upsert', OLD.`project_id`) WHERE OLD.`group_id` != NEW.`group_id`; END;--> statement-breakpoint
CREATE TRIGGER `feed_groups_project_rules` AFTER UPDATE OF `format_rules`, `exclusion_rules`, `source_language` ON `projects` BEGIN SELECT row_changed('groups', `id`, 'upsert', NEW.`id`) FROM `groups` WHERE `project_id` = NEW.`id`; END;
