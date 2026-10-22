-- What kind of failure a failed request was (the AI 호출 tab labels it); earlier requests have none.
ALTER TABLE `run_steps` ADD `error_kind` text;
