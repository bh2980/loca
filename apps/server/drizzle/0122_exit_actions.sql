-- 태그 붙이기·떼기 and 상태 변경 nodes are gone: tags and statuses are exit actions (docs/DESIGN-EXIT-ACTIONS.md). A run
-- keeps the tags its exit actions name (runs.tags), to make one again that is deleted while it runs. Lines waiting at
-- such a node go where its 다음 exit went (or end), then every definition is rewritten (exit_actions, db/index.ts).
ALTER TABLE `runs` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `run_items` SET `state` = 'done' WHERE `state` IN ('queued', 'running') AND exit_action_next((SELECT `definition` FROM `runs` WHERE `runs`.`id` = `run_items`.`run_id`), `node_id`) = '';--> statement-breakpoint
UPDATE `run_items` SET `node_id` = exit_action_next((SELECT `definition` FROM `runs` WHERE `runs`.`id` = `run_items`.`run_id`), `node_id`) WHERE `state` IN ('queued', 'running') AND exit_action_next((SELECT `definition` FROM `runs` WHERE `runs`.`id` = `run_items`.`run_id`), `node_id`) <> `node_id`;--> statement-breakpoint
UPDATE `runs` SET `definition` = exit_actions(`definition`);--> statement-breakpoint
UPDATE `workflows` SET `definition` = exit_actions(`definition`);
