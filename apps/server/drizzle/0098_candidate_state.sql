ALTER TABLE `candidates` ADD `state` text DEFAULT 'history' NOT NULL;--> statement-breakpoint
-- Existing candidates: an AI's text made after the line's current one that the line never took (a run on a line a person
-- translated, a chat suggestion) and differs from it beyond the kind of line break and the edges' whitespace waits for a decision, a run's last text only; every other one is history (the editor's
-- AI 번역·다듬기 went into the box and is not a suggestion).
UPDATE `candidates` SET `state` = 'pending'
WHERE `origin` IN ('ai', 'tool') AND `id` IN (
  SELECT c.`id` FROM `candidates` c
  JOIN `units` u ON u.`id` = c.`unit_id`
  JOIN `candidates` cur ON cur.`id` = u.`candidate_id`
  WHERE c.`id` <> u.`candidate_id` AND c.`created_at` > cur.`created_at` AND trim(replace(c.`text`, char(13), ''), ' ' || char(9, 10)) <> trim(replace(coalesce(u.`translation`, ''), char(13), ''), ' ' || char(9, 10))
    AND NOT (c.`run_id` IS NULL AND (c.`note` = 'AI 번역' OR c.`note` LIKE '다듬기%'))
    AND NOT EXISTS (
      SELECT 1 FROM `candidates` later
      WHERE later.`unit_id` = c.`unit_id` AND later.`run_id` = c.`run_id` AND later.`created_at` > c.`created_at`
    )
);
