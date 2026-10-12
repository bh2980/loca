ALTER TABLE `run_steps` ADD `cached_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `run_steps` ADD `reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `run_steps` ADD `cost_usd` real;--> statement-breakpoint
ALTER TABLE `runs` ADD `limits` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `notice` text;