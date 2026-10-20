-- Scene-level listener guesses are gone (2026-10-20): a listener stored as a scene guess becomes a per-line AI guess with its confidence.
UPDATE `units` SET `listener_origin` = 'ai' WHERE `listener_origin` = 'scene';
