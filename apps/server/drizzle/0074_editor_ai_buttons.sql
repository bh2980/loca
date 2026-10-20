-- 편집기 AI: one model for both buttons and flat autocomplete fields become each button's own AI node
-- settings (translate / refine), the autocomplete's (complete) and 정규식 만들기's (regex); what is not
-- stored here is filled from the presets when read (editorAiSchema).
UPDATE `projects` SET `editor_ai` = json_object(
  'translate', CASE WHEN json_type(`editor_ai`, '$.assistModel') = 'object' THEN json_object('model', json_extract(`editor_ai`, '$.assistModel')) ELSE json_object() END,
  'refine', CASE WHEN json_type(`editor_ai`, '$.assistModel') = 'object' THEN json_object('model', json_extract(`editor_ai`, '$.assistModel')) ELSE json_object() END,
  'complete', json_object(
    'enabled', CASE WHEN json_extract(`editor_ai`, '$.enabled') THEN json('true') ELSE json('false') END,
    'model', CASE WHEN json_type(`editor_ai`, '$.model') = 'object' THEN json_extract(`editor_ai`, '$.model') ELSE NULL END,
    'dailyCap', coalesce(json_extract(`editor_ai`, '$.dailyCap'), 200)
  )
) WHERE json_type(`editor_ai`, '$.translate') IS NULL;
