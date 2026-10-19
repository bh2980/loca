ALTER TABLE `tags` ADD `sort` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `statuses` DROP COLUMN `human_only`;--> statement-breakpoint
UPDATE `tags` SET `sort` = (SELECT count(*) FROM `tags` AS `t` WHERE `t`.`project_id` = `tags`.`project_id` AND `t`.`name` < `tags`.`name`);
