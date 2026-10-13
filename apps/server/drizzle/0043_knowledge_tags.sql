CREATE TABLE `knowledge_tags` (
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`note` text,
	PRIMARY KEY(`kind`, `item_id`, `tag_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_tags_tag` ON `knowledge_tags` (`tag_id`);--> statement-breakpoint
-- 확인 권장 moves from speech_rules.review to a tag (REVIEW_TAG) with the reasons as its note.
INSERT INTO `tags` (`id`, `project_id`, `name`, `color`, `role`)
  SELECT 'review-' || `project_id`, `project_id`, '확인 권장', '#f59e0b', 'review' FROM `speech_rules`
  WHERE `review` IS NOT NULL AND `review` <> '' AND `status` <> 'rejected'
  GROUP BY `project_id`;--> statement-breakpoint
INSERT INTO `knowledge_tags` (`kind`, `item_id`, `tag_id`, `note`)
  SELECT 'speechRules', `id`, 'review-' || `project_id`, `review` FROM `speech_rules`
  WHERE `review` IS NOT NULL AND `review` <> '' AND `status` <> 'rejected';--> statement-breakpoint
-- A tag row goes with its item.
CREATE TRIGGER `terms_tags_gone` AFTER DELETE ON `terms` BEGIN DELETE FROM `knowledge_tags` WHERE `kind` = 'terms' AND `item_id` = OLD.`id`; END;--> statement-breakpoint
CREATE TRIGGER `documents_tags_gone` AFTER DELETE ON `documents` BEGIN DELETE FROM `knowledge_tags` WHERE `kind` = 'documents' AND `item_id` = OLD.`id`; END;--> statement-breakpoint
CREATE TRIGGER `characters_tags_gone` AFTER DELETE ON `characters` BEGIN DELETE FROM `knowledge_tags` WHERE `kind` = 'characters' AND `item_id` = OLD.`id`; END;--> statement-breakpoint
CREATE TRIGGER `relationships_tags_gone` AFTER DELETE ON `relationships` BEGIN DELETE FROM `knowledge_tags` WHERE `kind` = 'relationships' AND `item_id` = OLD.`id`; END;--> statement-breakpoint
CREATE TRIGGER `story_events_tags_gone` AFTER DELETE ON `story_events` BEGIN DELETE FROM `knowledge_tags` WHERE `kind` = 'events' AND `item_id` = OLD.`id`; END;--> statement-breakpoint
CREATE TRIGGER `speech_rules_tags_gone` AFTER DELETE ON `speech_rules` BEGIN DELETE FROM `knowledge_tags` WHERE `kind` = 'speechRules' AND `item_id` = OLD.`id`; END;--> statement-breakpoint
ALTER TABLE `speech_rules` DROP COLUMN `review`;