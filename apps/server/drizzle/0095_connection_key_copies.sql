CREATE TABLE `connection_key_copies` (
	`target_id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
