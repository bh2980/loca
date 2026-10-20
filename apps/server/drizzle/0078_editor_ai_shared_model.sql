-- 설정 › 에디터: AI 번역 and 다듬기 share one model and context, each button keeping its instructions and include (the AI 번역 button's values become the shared ones); one 60-second time limit covers them and 자연어로 정규식 만들기, so the old limits go. Materials go whether or not a person confirmed them (humanOnly is no longer set here).
UPDATE `projects` SET `editor_ai` = json_remove(
  json_set(`editor_ai`,
    '$.model', json(json_extract(`editor_ai`, '$.translate.model')),
    '$.context', json(coalesce(json_extract(`editor_ai`, '$.translate.context'), '{}'))),
  '$.translate.model', '$.translate.context', '$.translate.timeoutMinutes', '$.translate.output', '$.translate.fields', '$.translate.preset',
  '$.refine.model', '$.refine.context', '$.refine.timeoutMinutes', '$.refine.output', '$.refine.fields', '$.refine.preset', '$.regex', '$.context.humanOnly')
WHERE json_extract(`editor_ai`, '$.translate.model') IS NOT NULL;
