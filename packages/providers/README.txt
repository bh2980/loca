Translation Workbench provider adapters

invokeProvider accepts a Connection, ExecutionProfile, prompt and JSON Schema.
It performs exactly one model call. Retry decisions and storage belong to the worker.
inspectConnection reads local CLI version/help or checks API configuration only.
It does not prove credentials, model access, endpoint availability, or per-model effort support.

OpenAI-compatible API:
  baseUrl includes the API prefix, e.g. https://example.test/v1.
  apiMode: chat (default) or responses.
  structuredOutput: json-schema (default), json-object, or text.
  text omits API response-format options but still requests JSON and validates the schema.
  tokenLimitField: max_completion_tokens (default) or max_tokens for Chat Completions.
  Responses always uses max_output_tokens, independently of this compatibility choice.
  envKey is an environment variable NAME; never an API key value.
  No hidden fallback: unsupported schema/effort responses remain errors.
  Native fetch avoids coupling a compatible endpoint to an account gateway.

CLI:
  Codex exec uses stdin, JSON Schema, final output file, read-only sandbox,
  ephemeral session, and --ignore-user-config (authentication remains CLI-owned).
  Before exec, config/read projects only credential-store, ChatGPT endpoint and login
  restrictions into explicit overrides, so login and isolated inference share the same
  auth backend. Raw config, tokens, hooks and MCP settings are never copied into exec.
  Hooks, shell tools and subagents are explicitly disabled for the translation turn.
  Bare Windows CLI names preserve PATH executable precedence; Codex npm shims are
  resolved to their JS entry without executing a command shell.
  Grok Build uses --prompt-file, structured JSON, no built-in tools/subagents/web,
  deny-all permission rule and dontAsk mode.
  Antigravity agy uses stdin print mode, structured JSON, plan mode and sandbox.
  All run in disposable temp directories, never in the game or workbench database directory.
  CLI restrictions differ; temp cwd is not an operating-system security boundary.
  Local CLI authentication, configuration, and account usage remain CLI-owned.
  CLI max output token caps are not exposed by verified help and cannot be guaranteed.
  Requested settings are distinct from settings actually reported in output.

Tests use local fake HTTP servers and fake child processes; no paid model calls.
Verified help: Codex 0.154.0, Grok Build 1.0.30, agy 1.2.7 (2026-10-08).
Official implementation references:
  https://learn.chatgpt.com/docs/non-interactive-mode
  https://learn.chatgpt.com/docs/config-file/config-reference
  https://developers.openai.com/api/docs/guides/structured-outputs

Account login adapters:
  inspectAuth and startLogin expose account metadata and in-memory login progress.
  Codex uses app-server account/read, login/start, login/completed and login/cancel.
  Grok uses its login subprocess; status without a fresh login remains unknown.
  Antigravity advertises terminal login only; installation is never treated as login.
  listModels uses Codex model/list and returns provider-advertised IDs/efforts only.
  Other providers currently return an empty automatic catalog with an explanation.
  Login URLs and device codes are ephemeral UI state, never persistent run logs.
  AuthState/accountLabel is CLI metadata, not proof of an unexpired inference quota.
  Request.credential accepts a worker-supplied memory-only API key, preferred over
  the legacy environment-variable reference. Neither credential source is logged.
  Authentication tests use fake subprocesses. Real account login was not performed
  while implementing or testing these adapters.
