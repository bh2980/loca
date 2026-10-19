ALTER TABLE `connections` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `connections` ADD `output_tokens` integer;--> statement-breakpoint
UPDATE `connections` SET `output_tokens` = `max_output_tokens` WHERE `max_output_tokens` IS NOT NULL;
