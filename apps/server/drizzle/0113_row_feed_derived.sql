-- The row feed (0106) for collections computed over many tables (src/feed.ts DERIVED): the event flow (each event with
-- where it happens and what follows it: events, their links and tags, their evidence lines' place, the dialogue
-- graph) and the workflows with their problems (workflows, statuses, tags, connections). A change to any of these
-- notes the collection as a whole ('*'); the feed computes it again and sends the rows that differ from the last sent.
-- A migration that rebuilds one of these tables must make its triggers again.
CREATE TRIGGER `feed_events_insert` AFTER INSERT ON `story_events` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_link_insert` AFTER INSERT ON `event_links` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_graph_node_insert` AFTER INSERT ON `graph_nodes` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_insert` AFTER INSERT ON `workflows` BEGIN SELECT row_changed('workflows', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_status_insert` AFTER INSERT ON `statuses` BEGIN SELECT row_changed('workflows', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_tag_insert` AFTER INSERT ON `tags` BEGIN SELECT row_changed('workflows', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_connection_insert` AFTER INSERT ON `connections` BEGIN SELECT row_changed('workflows', '*', 'upsert', `id`) FROM `projects` WHERE NEW.`project_id` IS NULL OR `id` = NEW.`project_id`; END;--> statement-breakpoint
CREATE TRIGGER `feed_events_update` AFTER UPDATE ON `story_events` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_link_update` AFTER UPDATE ON `event_links` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_graph_node_update` AFTER UPDATE OF `unit_ids`, `kind` ON `graph_nodes` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_update` AFTER UPDATE ON `workflows` BEGIN SELECT row_changed('workflows', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_status_update` AFTER UPDATE ON `statuses` BEGIN SELECT row_changed('workflows', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_tag_update` AFTER UPDATE ON `tags` BEGIN SELECT row_changed('workflows', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_connection_update` AFTER UPDATE ON `connections` BEGIN SELECT row_changed('workflows', '*', 'upsert', `id`) FROM `projects` WHERE NEW.`project_id` IS NULL OR `id` = NEW.`project_id`; END;--> statement-breakpoint
CREATE TRIGGER `feed_events_delete` AFTER DELETE ON `story_events` BEGIN SELECT row_changed('events', '*', 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_link_delete` AFTER DELETE ON `event_links` BEGIN SELECT row_changed('events', '*', 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_graph_node_delete` AFTER DELETE ON `graph_nodes` BEGIN SELECT row_changed('events', '*', 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_delete` AFTER DELETE ON `workflows` BEGIN SELECT row_changed('workflows', '*', 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_status_delete` AFTER DELETE ON `statuses` BEGIN SELECT row_changed('workflows', '*', 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_tag_delete` AFTER DELETE ON `tags` BEGIN SELECT row_changed('workflows', '*', 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_workflows_connection_delete` AFTER DELETE ON `connections` BEGIN SELECT row_changed('workflows', '*', 'upsert', `id`) FROM `projects` WHERE OLD.`project_id` IS NULL OR `id` = OLD.`project_id`; END;--> statement-breakpoint
CREATE TRIGGER `feed_events_graph_edge_insert` AFTER INSERT ON `graph_edges` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_tag_insert` AFTER INSERT ON `knowledge_tags` WHEN NEW.`kind` = 'events' BEGIN SELECT row_changed('events', '*', 'upsert', (SELECT `project_id` FROM `story_events` WHERE `id` = NEW.`item_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_unit_insert` AFTER INSERT ON `units` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_graph_edge_delete` AFTER DELETE ON `graph_edges` BEGIN SELECT row_changed('events', '*', 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_tag_delete` AFTER DELETE ON `knowledge_tags` WHEN OLD.`kind` = 'events' BEGIN SELECT row_changed('events', '*', 'upsert', (SELECT `project_id` FROM `story_events` WHERE `id` = OLD.`item_id`)); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_unit_delete` AFTER DELETE ON `units` BEGIN SELECT row_changed('events', '*', 'upsert', OLD.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_unit_update` AFTER UPDATE OF `key`, `seq`, `kind`, `group_id` ON `units` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_events_group_update` AFTER UPDATE OF `title`, `section` ON `groups` BEGIN SELECT row_changed('events', '*', 'upsert', NEW.`project_id`); END;
