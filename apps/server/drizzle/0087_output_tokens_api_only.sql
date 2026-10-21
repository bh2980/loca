-- Only API connections cap a call's output; CLIs and System One ignored the number, which still shrank batches.
UPDATE `connections` SET `output_tokens` = NULL WHERE `kind` <> 'openai';
