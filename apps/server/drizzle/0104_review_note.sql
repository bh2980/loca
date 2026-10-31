ALTER TABLE `characters` ADD `review_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `review_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `review_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `speech_rules` ADD `review_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `story_events` ADD `review_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- 확인 권장 becomes an automatic tag read off the item: the review tag's note moves onto the item it was on.
UPDATE `characters` SET `review_note` = COALESCE((SELECT kt.`note` FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'characters' AND kt.`item_id` = `characters`.`id`), '');--> statement-breakpoint
UPDATE `relationships` SET `review_note` = COALESCE((SELECT kt.`note` FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'relationships' AND kt.`item_id` = `relationships`.`id`), '');--> statement-breakpoint
UPDATE `speech_rules` SET `review_note` = COALESCE((SELECT kt.`note` FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'speechRules' AND kt.`item_id` = `speech_rules`.`id`), '');--> statement-breakpoint
UPDATE `story_events` SET `review_note` = COALESCE((SELECT kt.`note` FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'events' AND kt.`item_id` = `story_events`.`id`), '');--> statement-breakpoint
UPDATE `documents` SET `review_note` = COALESCE((SELECT kt.`note` FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'documents' AND kt.`item_id` = `documents`.`id`), '');--> statement-breakpoint
-- A mark put on without a reason still asks for a look.
UPDATE `characters` SET `review_note` = '확인 권장' WHERE `review_note` = '' AND EXISTS (SELECT 1 FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'characters' AND kt.`item_id` = `characters`.`id`);--> statement-breakpoint
UPDATE `relationships` SET `review_note` = '확인 권장' WHERE `review_note` = '' AND EXISTS (SELECT 1 FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'relationships' AND kt.`item_id` = `relationships`.`id`);--> statement-breakpoint
UPDATE `speech_rules` SET `review_note` = '확인 권장' WHERE `review_note` = '' AND EXISTS (SELECT 1 FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'speechRules' AND kt.`item_id` = `speech_rules`.`id`);--> statement-breakpoint
UPDATE `story_events` SET `review_note` = '확인 권장' WHERE `review_note` = '' AND EXISTS (SELECT 1 FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'events' AND kt.`item_id` = `story_events`.`id`);--> statement-breakpoint
UPDATE `documents` SET `review_note` = '확인 권장' WHERE `review_note` = '' AND EXISTS (SELECT 1 FROM `knowledge_tags` kt JOIN `tags` t ON t.`id` = kt.`tag_id` WHERE t.`role` = 'review' AND kt.`kind` = 'documents' AND kt.`item_id` = `documents`.`id`);--> statement-breakpoint
-- The review tag goes (its knowledge_tags rows with it, ON DELETE cascade); no tag is the app's any more.
DELETE FROM `knowledge_tags` WHERE `tag_id` IN (SELECT `id` FROM `tags` WHERE `role` = 'review');--> statement-breakpoint
DELETE FROM `unit_tags` WHERE `tag_id` IN (SELECT `id` FROM `tags` WHERE `role` = 'review');--> statement-breakpoint
DELETE FROM `tags` WHERE `role` = 'review';--> statement-breakpoint
ALTER TABLE `tags` DROP COLUMN `role`;
