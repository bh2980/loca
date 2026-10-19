PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`executable` text,
	`header_template` text,
	`created_at` integer NOT NULL,
	`options` text,
	`concurrency` integer DEFAULT 2 NOT NULL,
	`default_model` text,
	`default_effort` text,
	`timeout_seconds` integer DEFAULT 300 NOT NULL,
	`max_attempts` integer DEFAULT 2 NOT NULL,
	`max_output_tokens` integer,
	`fallback` text
);
--> statement-breakpoint
INSERT INTO `__new_connections`("id", "kind", "name", "base_url", "executable", "header_template", "created_at", "options", "concurrency", "default_model", "default_effort", "timeout_seconds", "max_attempts", "max_output_tokens", "fallback") SELECT "id", "kind", "name", "base_url", "executable", "header_template", "created_at", "options", "concurrency", "default_model", "default_effort", "timeout_seconds", "max_attempts", "max_output_tokens", "fallback" FROM `connections`;--> statement-breakpoint
DROP TABLE `connections`;--> statement-breakpoint
ALTER TABLE `__new_connections` RENAME TO `connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
UPDATE `connections` SET `max_output_tokens` = NULL WHERE `max_output_tokens` = 16000;
