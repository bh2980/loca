DROP TABLE `profiles`;--> statement-breakpoint
ALTER TABLE `ai_calls` DROP COLUMN `profile_id`;--> statement-breakpoint
ALTER TABLE `analysis_jobs` DROP COLUMN `profile_id`;--> statement-breakpoint
ALTER TABLE `candidates` DROP COLUMN `profile_id`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `profile_id`;--> statement-breakpoint
ALTER TABLE `run_steps` DROP COLUMN `profile_id`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `profiles`;--> statement-breakpoint
ALTER TABLE `term_jobs` DROP COLUMN `profile_id`;