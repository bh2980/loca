ALTER TABLE `units` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill: the line's position in the whole project script (group order, then unit order, stable by keys).
UPDATE `units` SET `seq` = (
  SELECT `r`.`n` FROM (
    SELECT `u`.`id` AS `id`, row_number() OVER (PARTITION BY `u`.`project_id` ORDER BY `g`.`sort`, `g`.`key`, `u`.`sort`, `u`.`key`) - 1 AS `n`
    FROM `units` `u` INNER JOIN `groups` `g` ON `g`.`id` = `u`.`group_id`
  ) `r` WHERE `r`.`id` = `units`.`id`
);--> statement-breakpoint
CREATE INDEX `units_seq` ON `units` (`project_id`,`seq`);
