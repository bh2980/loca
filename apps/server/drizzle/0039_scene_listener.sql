-- Listeners the work analysis copied from its per-scene guess become "scene" guesses; a guess a
-- listener workflow node recorded for the line itself (its run item says recorded) stays "ai".
UPDATE `units` SET `listener_origin` = 'scene'
WHERE `listener_origin` = 'ai'
  AND NOT EXISTS (SELECT 1 FROM `run_items` WHERE `run_items`.`unit_id` = `units`.`id` AND `run_items`.`data` LIKE '%"recorded":true%');
