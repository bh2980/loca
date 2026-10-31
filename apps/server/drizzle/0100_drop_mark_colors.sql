-- Automatic marks keep the colour they were made with; the per-project override (설정 › 상태·태그) is gone with them from that page.
ALTER TABLE `projects` DROP COLUMN `mark_colors`;