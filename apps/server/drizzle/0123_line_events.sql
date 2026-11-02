CREATE TABLE `event_actor` (
	`one` integer PRIMARY KEY NOT NULL,
	`run_id` text
);
--> statement-breakpoint
CREATE TABLE `line_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` text NOT NULL,
	`kind` text NOT NULL,
	`before` text,
	`after` text,
	`run_id` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `line_events_unit` ON `line_events` (`unit_id`,`at`);--> statement-breakpoint
-- What happened to a line, for its history (src/db/schema.ts lineEvents). `at` is now in ms. A tag that goes because
-- its line or the tag itself is deleted is not an event. A migration that rebuilds units, unit_tags or candidates must
-- make these again.
CREATE TRIGGER `line_events_status` AFTER UPDATE OF `status_id` ON `units` WHEN OLD.`status_id` IS NOT NEW.`status_id` BEGIN INSERT INTO `line_events` (`unit_id`, `kind`, `before`, `after`, `run_id`, `at`) VALUES (NEW.`id`, 'status', OLD.`status_id`, NEW.`status_id`, CASE WHEN NEW.`status_by` = 'ai' THEN NEW.`status_run_id` END, CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)); END;--> statement-breakpoint
CREATE TRIGGER `line_events_note` AFTER UPDATE OF `note` ON `units` WHEN OLD.`note` IS NOT NEW.`note` BEGIN INSERT INTO `line_events` (`unit_id`, `kind`, `before`, `after`, `run_id`, `at`) VALUES (NEW.`id`, 'note', OLD.`note`, NEW.`note`, NULL, CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)); END;--> statement-breakpoint
CREATE TRIGGER `line_events_text` AFTER UPDATE OF `candidate_id` ON `units` WHEN OLD.`candidate_id` IS NOT NEW.`candidate_id` AND OLD.`candidate_id` IS NOT NULL BEGIN INSERT INTO `line_events` (`unit_id`, `kind`, `before`, `after`, `run_id`, `at`) VALUES (NEW.`id`, 'text', OLD.`candidate_id`, NEW.`candidate_id`, (SELECT `run_id` FROM `candidates` WHERE `id` = NEW.`candidate_id`), CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)); END;--> statement-breakpoint
CREATE TRIGGER `line_events_tag_on` AFTER INSERT ON `unit_tags` BEGIN INSERT INTO `line_events` (`unit_id`, `kind`, `before`, `after`, `run_id`, `at`) VALUES (NEW.`unit_id`, 'tag', NULL, NEW.`tag_id`, (SELECT `run_id` FROM `event_actor` WHERE `one` = 1), CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)); END;--> statement-breakpoint
CREATE TRIGGER `line_events_tag_off` AFTER DELETE ON `unit_tags` WHEN EXISTS (SELECT 1 FROM `units` WHERE `id` = OLD.`unit_id`) AND EXISTS (SELECT 1 FROM `tags` WHERE `id` = OLD.`tag_id`) BEGIN INSERT INTO `line_events` (`unit_id`, `kind`, `before`, `after`, `run_id`, `at`) VALUES (OLD.`unit_id`, 'tag', OLD.`tag_id`, NULL, (SELECT `run_id` FROM `event_actor` WHERE `one` = 1), CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)); END;--> statement-breakpoint
CREATE TRIGGER `line_events_decline` AFTER UPDATE OF `state` ON `candidates` WHEN OLD.`state` = 'pending' AND NEW.`state` = 'declined' BEGIN INSERT INTO `line_events` (`unit_id`, `kind`, `before`, `after`, `run_id`, `at`) VALUES (NEW.`unit_id`, 'decline', NULL, NEW.`id`, NULL, CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)); END;--> statement-breakpoint
-- The line's history (line extras) reads again when one is written.
CREATE TRIGGER `feed_line_extras_line_events` AFTER INSERT ON `line_events` BEGIN SELECT row_changed('lineExtras', NEW.`unit_id`, 'upsert', (SELECT `project_id` FROM `units` WHERE `id` = NEW.`unit_id`)); END;
