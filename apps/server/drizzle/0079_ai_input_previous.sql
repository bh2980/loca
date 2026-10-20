-- An AI node's input is the previous step's result (input.previous) instead of a picked node (input.from): a node that read one reads the previous step now.
UPDATE `workflows` SET `definition` = json_set(`definition`, '$.nodes', (
  SELECT json_group_array(CASE WHEN json_extract(value, '$.config.input.from') IS NOT NULL
    THEN json(json_remove(json_set(value, '$.config.input.previous', json('true')), '$.config.input.from'))
    ELSE json(value) END)
  FROM json_each(`definition`, '$.nodes')))
WHERE `definition` LIKE '%"from":%';
--> statement-breakpoint
UPDATE `runs` SET `definition` = json_set(`definition`, '$.nodes', (
  SELECT json_group_array(CASE WHEN json_extract(value, '$.config.input.from') IS NOT NULL
    THEN json(json_remove(json_set(value, '$.config.input.previous', json('true')), '$.config.input.from'))
    ELSE json(value) END)
  FROM json_each(`definition`, '$.nodes')))
WHERE `definition` LIKE '%"from":%';
