-- run_steps: `attempts` and `round` belonged to calls spread over several routes and re-requested rounds, which are gone
-- (a call is one request on one connection). `retried` marks a failed call whose lines the node's retry rules all
-- sent back, so the 연속 실패 guard reads the same after a restart. The run status `preparing` needs no column change.
ALTER TABLE `run_steps` DROP COLUMN `attempts`;--> statement-breakpoint
ALTER TABLE `run_steps` DROP COLUMN `round`;--> statement-breakpoint
ALTER TABLE `run_steps` ADD `retried` integer DEFAULT false NOT NULL;
