-- 용어 AI 채우기 became the 용어 번역 workflow: its jobs table goes, and the candidates it called
-- ordinary words ("일반어로 보임") become what the workflow does with them, terms AI rejected.
DROP TABLE `term_jobs`;--> statement-breakpoint
UPDATE `terms` SET `status` = 'rejected', `status_by` = 'ai', `note` = '' WHERE `status` = 'candidate' AND `note` = '일반어로 보임' AND trim(`target`) = '';
