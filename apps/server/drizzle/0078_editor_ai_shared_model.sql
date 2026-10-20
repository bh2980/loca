-- 설정 › 에디터: AI 번역 and 다듬기 share one model, context and time limit; each button keeps its instructions and include. The AI 번역 button's values become the shared ones.
UPDATE `projects` SET `editor_ai` = json_remove(
  json_set(`editor_ai`,
    '$.model', json(json_extract(`editor_ai`, '$.translate.model')),
    '$.context', json(coalesce(json_extract(`editor_ai`, '$.translate.context'), '{}')),
    '$.timeoutMinutes', coalesce(json_extract(`editor_ai`, '$.translate.timeoutMinutes'), 2)),
  '$.translate.model', '$.translate.context', '$.translate.timeoutMinutes', '$.translate.output', '$.translate.fields', '$.translate.preset',
  '$.refine.model', '$.refine.context', '$.refine.timeoutMinutes', '$.refine.output', '$.refine.fields', '$.refine.preset')
WHERE json_extract(`editor_ai`, '$.translate.model') IS NOT NULL;
