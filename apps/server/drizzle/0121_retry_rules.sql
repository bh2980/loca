-- 재요청 nodes are gone: an AI node retries by its rules (config.retries, or the workflow's settings.retries). Items
-- queued at a retry node go to the AI node it sent back to, then every definition is rewritten (retry_rules, db/index.ts).
UPDATE `run_items` SET `node_id` = retry_node_origin((SELECT `definition` FROM `runs` WHERE `runs`.`id` = `run_items`.`run_id`), `node_id`) WHERE `state` IN ('queued', 'running') AND retry_node_origin((SELECT `definition` FROM `runs` WHERE `runs`.`id` = `run_items`.`run_id`), `node_id`) <> `node_id`;--> statement-breakpoint
UPDATE `runs` SET `definition` = retry_rules(`definition`);--> statement-breakpoint
UPDATE `workflows` SET `definition` = retry_rules(`definition`);
