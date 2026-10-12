ALTER TABLE `ai_calls` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `analysis_jobs` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `analysis_jobs` ADD `effort` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `model` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `effort` text;--> statement-breakpoint
ALTER TABLE `connections` ADD `default_model` text;--> statement-breakpoint
ALTER TABLE `connections` ADD `default_effort` text;--> statement-breakpoint
ALTER TABLE `connections` ADD `timeout_seconds` integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `max_attempts` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `max_output_tokens` integer DEFAULT 16000 NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `fallback` text;--> statement-breakpoint
ALTER TABLE `run_steps` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `models` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `term_jobs` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `term_jobs` ADD `model` text;--> statement-breakpoint
ALTER TABLE `term_jobs` ADD `effort` text;--> statement-breakpoint
-- Model profiles go away: each place that used one gets the profile's connection, model and effort,
-- and the connection takes the call settings (the largest of its profiles') and the first fallback.
UPDATE `connections` SET
  `default_model` = (SELECT `model` FROM `profiles` p WHERE p.`connection_id` = `connections`.`id` ORDER BY p.`name` LIMIT 1),
  `default_effort` = (SELECT nullif(`effort`, '') FROM `profiles` p WHERE p.`connection_id` = `connections`.`id` ORDER BY p.`name` LIMIT 1),
  `timeout_seconds` = coalesce((SELECT max(`timeout_seconds`) FROM `profiles` p WHERE p.`connection_id` = `connections`.`id`), `timeout_seconds`),
  `max_attempts` = coalesce((SELECT max(`max_attempts`) FROM `profiles` p WHERE p.`connection_id` = `connections`.`id`), `max_attempts`),
  `max_output_tokens` = coalesce((SELECT max(`max_output_tokens`) FROM `profiles` p WHERE p.`connection_id` = `connections`.`id`), `max_output_tokens`),
  `fallback` = (
    SELECT json_patch(json_object('connectionId', json_extract(f.value, '$.connectionId'), 'model', json_extract(f.value, '$.model')), json_object('effort', nullif(json_extract(f.value, '$.effort'), '')))
    FROM `profiles` p, json_each(p.`fallbacks`) f
    WHERE p.`connection_id` = `connections`.`id` AND json_extract(f.value, '$.connectionId') != `connections`.`id`
    ORDER BY p.`name`, f.key LIMIT 1
  );
--> statement-breakpoint
UPDATE `chat_sessions` SET
  `connection_id` = (SELECT `connection_id` FROM `profiles` WHERE `id` = `chat_sessions`.`profile_id`),
  `model` = (SELECT `model` FROM `profiles` WHERE `id` = `chat_sessions`.`profile_id`),
  `effort` = (SELECT nullif(`effort`, '') FROM `profiles` WHERE `id` = `chat_sessions`.`profile_id`)
WHERE `profile_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `analysis_jobs` SET
  `connection_id` = (SELECT `connection_id` FROM `profiles` WHERE `id` = `analysis_jobs`.`profile_id`),
  `effort` = (SELECT nullif(`effort`, '') FROM `profiles` WHERE `id` = `analysis_jobs`.`profile_id`)
WHERE `profile_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `term_jobs` SET
  `connection_id` = (SELECT `connection_id` FROM `profiles` WHERE `id` = `term_jobs`.`profile_id`),
  `model` = (SELECT `model` FROM `profiles` WHERE `id` = `term_jobs`.`profile_id`),
  `effort` = (SELECT nullif(`effort`, '') FROM `profiles` WHERE `id` = `term_jobs`.`profile_id`)
WHERE `profile_id` IS NOT NULL;
--> statement-breakpoint
-- A logged call went through the profile's own connection when its kind matches (else a fallback, unknown now).
UPDATE `ai_calls` SET `connection_id` = (
  SELECT p.`connection_id` FROM `profiles` p JOIN `connections` c ON c.`id` = p.`connection_id`
  WHERE p.`id` = `ai_calls`.`profile_id` AND c.`kind` = `ai_calls`.`connection_kind`
) WHERE `profile_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `ai_calls` SET `ref_id` = `connection_id` WHERE `kind` = 'test';
--> statement-breakpoint
UPDATE `run_steps` SET `connection_id` = (
  SELECT json_extract(r.`profiles`, '$."' || `run_steps`.`profile_id` || '".routes[0].connectionId') FROM `runs` r WHERE r.`id` = `run_steps`.`run_id`
) WHERE `profile_id` IS NOT NULL;
--> statement-breakpoint
-- AI nodes: the profile becomes the node's model; its instructions follow the node's own; its temperature becomes the node's.
UPDATE `workflows` SET `definition` = json_set(`definition`, '$.nodes', json((
  SELECT json_group_array(json(CASE WHEN json_extract(n.value, '$.type') = 'ai' THEN json_patch(
    json_set(
      json_remove(n.value, '$.config.profileId', '$.config.extraProfileIds'),
      '$.config.model', json(CASE WHEN p.`id` IS NULL THEN json_object('connectionId', '', 'model', '') ELSE json_patch(json_object('connectionId', p.`connection_id`, 'model', p.`model`), json_object('effort', nullif(p.`effort`, ''))) END),
      '$.config.extraModels', json((
        SELECT json_group_array(json(json_patch(json_object('connectionId', x.`connection_id`, 'model', x.`model`), json_object('effort', nullif(x.`effort`, '')))) ORDER BY e.key)
        FROM json_each(n.value, '$.config.extraProfileIds') e JOIN `profiles` x ON x.`id` = e.value
      )),
      '$.config.instructions', trim(coalesce(json_extract(n.value, '$.config.instructions'), '') || char(10) || char(10) || coalesce(p.`instructions`, ''), ' ' || char(10))
    ),
    json_object('config', json_object('temperature', p.`temperature`))
  ) ELSE n.value END) ORDER BY n.key)
  FROM json_each(`workflows`.`definition`, '$.nodes') n LEFT JOIN `profiles` p ON p.`id` = json_extract(n.value, '$.config.profileId')
)));
--> statement-breakpoint
-- Runs: the same from the profiles they froze, and the frozen profiles become frozen model choices.
UPDATE `runs` SET `definition` = json_set(`definition`, '$.nodes', json((
  SELECT json_group_array(json(CASE WHEN json_extract(n.value, '$.type') = 'ai' THEN json_patch(
    json_set(
      json_remove(n.value, '$.config.profileId', '$.config.extraProfileIds'),
      '$.config.model', json(coalesce((
        SELECT json_patch(json_object('connectionId', json_extract(p.value, '$.routes[0].connectionId'), 'model', json_extract(p.value, '$.routes[0].model')), json_object('effort', nullif(json_extract(p.value, '$.routes[0].effort'), '')))
        FROM json_each(`runs`.`profiles`) p WHERE p.key = json_extract(n.value, '$.config.profileId') AND json_array_length(p.value, '$.routes') > 0
      ), json_object('connectionId', '', 'model', ''))),
      '$.config.extraModels', json((
        SELECT json_group_array(json(json_patch(json_object('connectionId', json_extract(p.value, '$.routes[0].connectionId'), 'model', json_extract(p.value, '$.routes[0].model')), json_object('effort', nullif(json_extract(p.value, '$.routes[0].effort'), '')))) ORDER BY e.key)
        FROM json_each(n.value, '$.config.extraProfileIds') e JOIN json_each(`runs`.`profiles`) p ON p.key = e.value
        WHERE json_array_length(p.value, '$.routes') > 0
      )),
      '$.config.instructions', trim(coalesce(json_extract(n.value, '$.config.instructions'), '') || char(10) || char(10) || coalesce((
        SELECT json_extract(p.value, '$.instructions') FROM json_each(`runs`.`profiles`) p WHERE p.key = json_extract(n.value, '$.config.profileId')
      ), ''), ' ' || char(10))
    ),
    json_object('config', json_object('temperature', (SELECT json_extract(p.value, '$.temperature') FROM json_each(`runs`.`profiles`) p WHERE p.key = json_extract(n.value, '$.config.profileId'))))
  ) ELSE n.value END) ORDER BY n.key)
  FROM json_each(`runs`.`definition`, '$.nodes') n
)));
--> statement-breakpoint
UPDATE `runs` SET `models` = coalesce((
  SELECT json_group_object(
    json_extract(p.value, '$.routes[0].connectionId') || '|' || json_extract(p.value, '$.routes[0].model') || '|' || coalesce(json_extract(p.value, '$.routes[0].effort'), ''),
    json_object(
      'label', json_extract(p.value, '$.name'),
      'maxOutputTokens', json_extract(p.value, '$.maxOutputTokens'),
      'timeoutSeconds', json_extract(p.value, '$.timeoutSeconds'),
      'maxAttempts', json_extract(p.value, '$.maxAttempts'),
      'routes', json((
        SELECT json_group_array(json(json_set(r.value, '$.name', coalesce((SELECT c.`name` FROM `connections` c WHERE c.`id` = json_extract(r.value, '$.connectionId')), json_extract(r.value, '$.kind')))) ORDER BY r.key)
        FROM json_each(p.value, '$.routes') r
      ))
    )
  )
  FROM json_each(`runs`.`profiles`) p WHERE json_array_length(p.value, '$.routes') > 0
), '{}');
--> statement-breakpoint
UPDATE `proposals` SET `status` = 'failed', `result` = json_object('ok', json('false'), 'error', '모델 프로필이 없어져 적용할 수 없습니다.'), `decided_at` = cast(unixepoch('subsec') * 1000 as integer)
WHERE `tool` = 'save_profile' AND `status` = 'pending';
--> statement-breakpoint
UPDATE `projects` SET `agent_settings` = json_set(`agent_settings`, '$.disabledTools', json((
  SELECT json_group_array(value) FROM json_each(`projects`.`agent_settings`, '$.disabledTools') WHERE value != 'save_profile'
)));
