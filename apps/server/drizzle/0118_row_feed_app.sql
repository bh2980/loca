ALTER TABLE `connections` ADD `key_updated_at` integer;--> statement-breakpoint
-- The row feed (0106) for what belongs to the app rather than one project, noted under the scope 'app'
-- (APP_FEED in @tw/shared): the projects list (a project's own row and its line count), the home's defaults,
-- and connections (the home's under 'app', a project's under that project). A key lives in the OS keyring,
-- so setting or removing one writes key_updated_at for the row to change. A migration that rebuilds one of
-- these tables must make its triggers again.
CREATE TRIGGER `feed_app_projects_insert` AFTER INSERT ON `projects` BEGIN SELECT row_changed('projects', NEW.`id`, 'upsert', 'app'); END;--> statement-breakpoint
CREATE TRIGGER `feed_app_projects_update` AFTER UPDATE ON `projects` BEGIN SELECT row_changed('projects', NEW.`id`, 'upsert', 'app'); END;--> statement-breakpoint
CREATE TRIGGER `feed_app_projects_delete` AFTER DELETE ON `projects` BEGIN SELECT row_changed('projects', OLD.`id`, 'delete', 'app'); END;--> statement-breakpoint
CREATE TRIGGER `feed_app_projects_unit_insert` AFTER INSERT ON `units` BEGIN SELECT row_changed('projects', NEW.`project_id`, 'upsert', 'app'); END;--> statement-breakpoint
CREATE TRIGGER `feed_app_projects_unit_delete` AFTER DELETE ON `units` BEGIN SELECT row_changed('projects', OLD.`project_id`, 'upsert', 'app'); END;--> statement-breakpoint
CREATE TRIGGER `feed_app_defaults_insert` AFTER INSERT ON `app_settings` BEGIN SELECT row_changed('appDefaults', 'defaults', 'upsert', 'app'); END;--> statement-breakpoint
CREATE TRIGGER `feed_app_defaults_update` AFTER UPDATE OF `defaults` ON `app_settings` BEGIN SELECT row_changed('appDefaults', 'defaults', 'upsert', 'app'); END;--> statement-breakpoint
CREATE TRIGGER `feed_connections_insert` AFTER INSERT ON `connections` BEGIN SELECT row_changed('connections', NEW.`id`, 'upsert', coalesce(NEW.`project_id`, 'app')); END;--> statement-breakpoint
CREATE TRIGGER `feed_connections_update` AFTER UPDATE ON `connections` BEGIN SELECT row_changed('connections', NEW.`id`, 'upsert', coalesce(NEW.`project_id`, 'app')); END;--> statement-breakpoint
CREATE TRIGGER `feed_connections_delete` AFTER DELETE ON `connections` BEGIN SELECT row_changed('connections', OLD.`id`, 'delete', coalesce(OLD.`project_id`, 'app')); END;--> statement-breakpoint
CREATE TRIGGER `feed_connections_key_copy_insert` AFTER INSERT ON `connection_key_copies` BEGIN SELECT row_changed('connections', NEW.`target_id`, 'upsert', (SELECT coalesce(`project_id`, 'app') FROM `connections` WHERE `id` = NEW.`target_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_connections_key_copy_delete` AFTER DELETE ON `connection_key_copies` BEGIN SELECT row_changed('connections', OLD.`target_id`, 'upsert', (SELECT coalesce(`project_id`, 'app') FROM `connections` WHERE `id` = OLD.`target_id`)); END;
