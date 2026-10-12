-- The HTTP node now holds its full address; a connection is only the API key. Old nodes get base URL + path.
UPDATE `workflows` SET `definition` = json_set(`definition`, '$.nodes', (
  SELECT json_group_array(json(CASE
    WHEN json_extract(n.value, '$.config.fn') = 'http' AND json_type(n.value, '$.config.params.path') IS NOT NULL THEN
      json_remove(json_set(n.value, '$.config.params.url',
        rtrim(coalesce((SELECT `base_url` FROM `connections` c WHERE c.`id` = json_extract(n.value, '$.config.params.connectionId')), ''), '/')
        || '/' || ltrim(json_extract(n.value, '$.config.params.path'), '/')), '$.config.params.path')
    ELSE n.value END))
  FROM json_each(`workflows`.`definition`, '$.nodes') n
)) WHERE `definition` LIKE '%"fn":"http"%';
