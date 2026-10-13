-- Earlier databases could hold the same term twice (case aside): keep the oldest as it is and rename the
-- others "<source> (중복 <rowid>)" (unique, and stable while the update runs) so nothing is lost and the person can merge or delete them in the glossary.
UPDATE `terms` SET `source` = `source` || ' (중복 ' || `rowid` || ')', `lines` = NULL
WHERE EXISTS (
  SELECT 1 FROM `terms` AS `earlier`
  WHERE `earlier`.`project_id` = `terms`.`project_id` AND lower(`earlier`.`source`) = lower(`terms`.`source`) AND `earlier`.`rowid` < `terms`.`rowid`
);--> statement-breakpoint
CREATE UNIQUE INDEX `terms_source` ON `terms` (`project_id`,lower("source"));
