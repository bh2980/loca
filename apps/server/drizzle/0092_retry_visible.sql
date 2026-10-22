ALTER TABLE `run_items` ADD `not_before` integer;--> statement-breakpoint
ALTER TABLE `connections` DROP COLUMN `max_attempts`;--> statement-breakpoint
ALTER TABLE `connections` DROP COLUMN `fallback`;--> statement-breakpoint
-- A run's frozen model choices no longer carry a fallback chain or attempts: one route each.
UPDATE `runs` SET `models` = (
  SELECT coalesce(json_group_object(m.`key`, json_set(json_remove(m.`value`, '$.routes', '$.maxAttempts'), '$.route', json(json_extract(m.`value`, '$.routes[0]')))), '{}')
  FROM json_each(`runs`.`models`) m
) WHERE `models` != '{}';
