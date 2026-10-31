-- The row feed (0106) for proposals: the browser holds the ones its panels show (src/routes/proposals.ts by-ids) and reads
-- one again when it is named here (filed, decided, reported, undone). A migration that rebuilds proposals must make these again.
CREATE TRIGGER `feed_proposals_insert` AFTER INSERT ON `proposals` BEGIN SELECT row_changed('proposals', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_proposals_update` AFTER UPDATE ON `proposals` BEGIN SELECT row_changed('proposals', NEW.`id`, 'upsert', NEW.`project_id`); END;--> statement-breakpoint
CREATE TRIGGER `feed_proposals_delete` AFTER DELETE ON `proposals` BEGIN SELECT row_changed('proposals', OLD.`id`, 'delete', OLD.`project_id`); END;
