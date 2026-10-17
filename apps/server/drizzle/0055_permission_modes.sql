ALTER TABLE `chat_sessions` ADD `permission_mode` text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `decided_by` text;--> statement-breakpoint
ALTER TABLE `proposals` ADD `review` text;--> statement-breakpoint
-- Decisions made before #45 were all made on a card.
UPDATE `proposals` SET `decided_by` = 'person' WHERE `decided_at` IS NOT NULL;
