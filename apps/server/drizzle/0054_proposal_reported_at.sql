ALTER TABLE `proposals` ADD `reported_at` integer;--> statement-breakpoint
-- Decisions made before #46 count as told: the old code reported them on the next turn.
UPDATE `proposals` SET `reported_at` = `decided_at` WHERE `decided_at` IS NOT NULL;
