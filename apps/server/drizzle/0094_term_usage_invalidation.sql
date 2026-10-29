-- Source edits invalidate both occurrence counts and retained example keys.
CREATE TRIGGER terms_usage_insert AFTER INSERT ON units BEGIN
  UPDATE terms SET lines = NULL, examples = '[]' WHERE project_id = NEW.project_id AND (lines IS NOT NULL OR examples <> '[]');
END;
--> statement-breakpoint
CREATE TRIGGER terms_usage_delete AFTER DELETE ON units BEGIN
  UPDATE terms SET lines = NULL, examples = '[]' WHERE project_id = OLD.project_id AND (lines IS NOT NULL OR examples <> '[]');
END;
--> statement-breakpoint
CREATE TRIGGER terms_usage_update AFTER UPDATE OF source, speaker, key, seq, project_id ON units
WHEN OLD.source IS NOT NEW.source OR OLD.speaker IS NOT NEW.speaker OR OLD.key IS NOT NEW.key OR OLD.seq IS NOT NEW.seq OR OLD.project_id IS NOT NEW.project_id
BEGIN
  UPDATE terms SET lines = NULL, examples = '[]' WHERE project_id IN (OLD.project_id, NEW.project_id) AND (lines IS NOT NULL OR examples <> '[]');
END;
--> statement-breakpoint
UPDATE terms SET lines = NULL, examples = '[]';
