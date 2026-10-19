ALTER TABLE `connections` DROP COLUMN `options`;--> statement-breakpoint
DELETE FROM `connections` WHERE `kind` = 'pi';
--> statement-breakpoint
UPDATE `proposals` SET `source` = 'cli' WHERE `source` = 'pi';
