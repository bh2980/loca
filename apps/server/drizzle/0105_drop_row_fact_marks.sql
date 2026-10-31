-- 남은 줄, AI 초안, 청자 미상, 메모, 번역 제외, 번역 누락 are filters on what a row shows now, not automatic tags: their stored names and colours go.
UPDATE `projects` SET `mark_styles` = json_remove(`mark_styles`, '$.remaining', '$.ai', '$.unknownListener', '$.noted', '$.excluded', '$.emptyTarget') WHERE `mark_styles` <> '{}';--> statement-breakpoint
-- A workflow condition that asked for one of them asks for the fact instead (fact_conditions, db/index.ts).
UPDATE `workflows` SET `definition` = fact_conditions(`definition`) WHERE `definition` LIKE '%unit.marks%';
