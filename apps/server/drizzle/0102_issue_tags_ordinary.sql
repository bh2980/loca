-- The tags for what checks and reviews find (형식, 용어, 말투, 의미, 문체, 기타 지적, AI 실패) become ordinary tags: no role, their
-- place (lines) and 설명 written down, and the old short names that came with the app read as what they mean. Workflows
-- that named them by kind get their ids (issue_tag_nodes, registered in db/index.ts) before the roles go. A kind a project
-- never met had no tag (it was made on first use); it gets one now, as a new project does.
INSERT INTO `tags` (`id`, `project_id`, `name`, `color`, `role`, `scope`, `sort`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  p.`id`, k.`name`, k.`color`, k.`role`, '["lines"]', 0
FROM `projects` p
JOIN (
  SELECT 'format' AS `role`, '형식 오류' AS `name`, '#c46016' AS `color`
  UNION ALL SELECT 'term', '용어 위반', '#b26f00'
  UNION ALL SELECT 'speech', '말투 어긋남', '#bc5694'
  UNION ALL SELECT 'meaning', '의미 오류', '#d24c49'
  UNION ALL SELECT 'style', '문체 어색', '#8f68cb'
  UNION ALL SELECT 'other', '기타 지적', '#79818c'
  UNION ALL SELECT 'aiFailed', 'AI 실패', '#6076de'
) k
WHERE NOT EXISTS (SELECT 1 FROM `tags` t WHERE t.`project_id` = p.`id` AND (t.`role` = k.`role` OR lower(t.`name`) = lower(k.`name`)));
--> statement-breakpoint
UPDATE `workflows` SET `definition` = issue_tag_nodes(`definition`, (
  SELECT json_group_object(t.`role`, t.`id`) FROM `tags` t
  WHERE t.`project_id` = `workflows`.`project_id` AND t.`role` IN ('format', 'term', 'speech', 'meaning', 'style', 'other', 'aiFailed')
))
WHERE `definition` LIKE '%tagLines%';
--> statement-breakpoint
UPDATE `tags` SET
  `name` = CASE
    WHEN `role` = 'format' AND `name` = '형식' THEN '형식 오류'
    WHEN `role` = 'term' AND `name` = '용어' THEN '용어 위반'
    WHEN `role` = 'speech' AND `name` = '말투' THEN '말투 어긋남'
    WHEN `role` = 'meaning' AND `name` = '의미' THEN '의미 오류'
    WHEN `role` = 'style' AND `name` = '문체' THEN '문체 어색'
    ELSE `name`
  END,
  `description` = CASE WHEN `description` <> '' THEN `description` ELSE CASE `role`
    WHEN 'format' THEN '원문의 자리표시자·태그·줄바꿈이 번역에서 빠졌거나 달라짐 (형식 검사, AI 검수)'
    WHEN 'term' THEN '원문에 나온 확정 용어가 용어집의 번역어대로 쓰이지 않음 (용어 검사, AI 검수)'
    WHEN 'speech' THEN '화자 → 청자 말투 규칙(존댓말·반말, 호칭)과 번역의 말투가 다름 (말투 판정, AI 검수)'
    WHEN 'meaning' THEN '원문과 뜻이 다름: 오역, 빠뜨린 내용, 원문에 없는 내용 (AI 검수)'
    WHEN 'style' THEN '뜻은 맞지만 한국어가 어색하거나 부자연스러움 (AI 검수)'
    WHEN 'other' THEN 'AI 검수가 위 다섯 가지에 들지 않는다고 본 문제'
    WHEN 'aiFailed' THEN '번역의 문제가 아니라, 이 줄의 AI 단계가 다시 시도해도 끝내 실패함 (연결 끊김, 응답 잘림 등)'
  END END,
  `scope` = '["lines"]',
  `role` = NULL
WHERE `role` IN ('format', 'term', 'speech', 'meaning', 'style', 'other', 'aiFailed');
