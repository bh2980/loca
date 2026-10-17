ALTER TABLE `chat_sessions` ADD `pending_steers` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `reason` text;