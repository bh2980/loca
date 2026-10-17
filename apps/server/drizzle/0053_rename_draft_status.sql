-- The default '초벌' status was named 'AI 초벌', which was wrong for imported and human first drafts (#51).
UPDATE `statuses` SET `name` = '초벌' WHERE `name` = 'AI 초벌' AND `kind` = 'normal';
