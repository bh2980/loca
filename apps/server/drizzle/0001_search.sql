-- Trigram index over source, translation, speaker and key: substring search that works for Korean and English.
CREATE VIRTUAL TABLE `units_fts` USING fts5(source, translation, speaker, key, content='units', content_rowid='rowid', tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER `units_fts_insert` AFTER INSERT ON `units` BEGIN
  INSERT INTO units_fts(rowid, source, translation, speaker, key) VALUES (new.rowid, new.source, new.translation, new.speaker, new.key);
END;
--> statement-breakpoint
CREATE TRIGGER `units_fts_delete` AFTER DELETE ON `units` BEGIN
  INSERT INTO units_fts(units_fts, rowid, source, translation, speaker, key) VALUES ('delete', old.rowid, old.source, old.translation, old.speaker, old.key);
END;
--> statement-breakpoint
CREATE TRIGGER `units_fts_update` AFTER UPDATE OF source, translation, speaker, key ON `units` BEGIN
  INSERT INTO units_fts(units_fts, rowid, source, translation, speaker, key) VALUES ('delete', old.rowid, old.source, old.translation, old.speaker, old.key);
  INSERT INTO units_fts(rowid, source, translation, speaker, key) VALUES (new.rowid, new.source, new.translation, new.speaker, new.key);
END;
