import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execa, ExecaError } from 'execa';
import type { ConnectionKind } from '@tw/shared';
import { cliCommand, cliMissing, codexIsolationArgs, execaCli, idleMessage, idleTimeout, opencodeUsage, watchIdle } from './cli.ts';
import { ModelError } from './errors.ts';
import { readUsage, type ResolvedRoute, type Usage } from './types.ts';

/**
 * One turn of a multi-turn conversation with an agent CLI. Every CLI here keeps its own session
 * on disk and can resume it by id, so the conversation lives in the CLI, not in our prompt:
 *
 * | CLI         | new session                 | next turn                   | answer events                          |
 * |-------------|-----------------------------|-----------------------------|----------------------------------------|
 * | Claude Code | `--session-id <uuid>`       | `--resume <uuid>`           | `--output-format json` (result)        |
 * | Grok        | `--session-id <uuid>`       | `--resume <uuid>`           | `--output-format json` (result)        |
 * | Codex       | `codex exec --json`         | `codex exec resume <id>`    | JSONL: thread.started, agent_message   |
 * | agy         | stream-json, `init` gives id| `--conversation <id>`       | stream-json `result.response`          |
 * | opencode    | `run --format json`         | `run --session <id>`        | JSON parts with sessionID, text parts  |
 *
 * The CLIs' own tools (shell, files, web) stay off: Grok cannot limit its shell to one command
 * and agy denies tools in headless mode, so workbench tools go through the server instead
 * (the agent asks for them in its answer; see apps/server/src/services/cli-chat.ts).
 */
export type ChatCliKind = Extract<ConnectionKind, 'codex' | 'claude' | 'grok' | 'antigravity' | 'opencode'>;
export const CHAT_CLI_KINDS: ChatCliKind[] = ['codex', 'claude', 'grok', 'antigravity', 'opencode'];

export interface CliChatTurn {
  /** The CLI's session id from an earlier turn; absent for a new conversation. */
  sessionId?: string;
  /** Instructions for the agent. CLIs without a system-prompt flag get them in the first message. */
  system: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** The conversation's running total after the previous turn (`totals` of its result). */
  totalsBefore?: Usage;
}

export interface CliChatResult {
  sessionId: string;
  text: string;
  /** This turn's own use. */
  usage: Usage;
  /**
   * Set when the CLI reports the conversation's running total instead of the turn's (Antigravity:
   * its numbers only grow across a resumed conversation); pass it back as the next `totalsBefore`.
   */
  totals?: Usage;
}

const USAGE_KEYS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'costUsd'] as const;
/** A turn's share of a running total. A total smaller than before means the CLI started over. */
export const turnShare = (totals: Usage, before: Usage | undefined): Usage => {
  if (!before || (totals.inputTokens ?? 0) < (before.inputTokens ?? 0)) return totals;
  return Object.fromEntries(USAGE_KEYS.flatMap((key) => (totals[key] === undefined ? [] : [[key, Math.max(0, totals[key]! - (before[key] ?? 0))]])));
};

const lines = (stdout: string) =>
  stdout.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
const usageOf = (raw: unknown, cost?: unknown): Usage => readUsage(raw, cost);
const QUOTA = /quota|RESOURCE_EXHAUSTED|rate.?limit|usage limit|too many requests|\b429\b/i;
const failure = (detail: string) => (QUOTA.test(detail) ? new ModelError('rate-limit', `CLI 사용량 한도에 도달했습니다. ${detail}`) : new ModelError('cli', `CLI가 실패를 반환했습니다: ${detail}`, false));

/** First turn: CLIs without a system-prompt option get instructions in the message; Codex uses a file. */
const firstMessage = (turn: CliChatTurn) => (turn.sessionId ? turn.prompt : `${turn.system}\n\n---\n\n${turn.prompt}`);

export function cliChatCommand(kind: ChatCliKind, route: ResolvedRoute, turn: CliChatTurn, newId: string, instructionsFile: string): { args: string[]; input?: string } {
  const effort = route.effort;
  switch (kind) {
    case 'claude':
      return {
        args: [
          '--print', '--safe-mode', '--model', route.model, '--output-format', 'json', '--input-format', 'text',
          ...(turn.sessionId ? ['--resume', turn.sessionId] : ['--session-id', newId]),
          '--append-system-prompt', turn.system, '--tools', '', '--permission-mode', 'dontAsk', '--no-chrome',
          '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
          ...(effort ? ['--effort', effort] : []),
        ],
        input: turn.prompt,
      };
    case 'grok':
      return {
        args: [
          '--single', turn.prompt, '--model', route.model, '--output-format', 'json',
          ...(turn.sessionId ? ['--resume', turn.sessionId] : ['--session-id', newId]),
          '--system-prompt-override', turn.system, '--no-subagents', '--disable-web-search', '--tools', '', '--deny', '*', '--permission-mode', 'dontAsk',
          ...(effort ? ['--reasoning-effort', effort] : []),
        ],
      };
    case 'codex':
      return {
        args: [
          'exec', ...(turn.sessionId ? ['resume', turn.sessionId] : []),
          '--model', route.model, '--skip-git-repo-check', '--json', '--ignore-user-config',
          ...(turn.sessionId ? ['-c', 'sandbox_mode="read-only"'] : ['--sandbox', 'read-only', '--color', 'never']),
          ...codexIsolationArgs(instructionsFile),
          ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : []),
          '-',
        ],
        input: turn.prompt,
      };
    case 'antigravity':
      return {
        args: [
          '--print=', '--input-format', 'stream-json', '--output-format', 'stream-json', '--model', route.model, '--sandbox', '--disable-slash-commands',
          '--print-timeout', `${Math.ceil(turn.timeoutMs / 1000)}s`, ...(turn.sessionId ? ['--conversation', turn.sessionId] : []),
          ...(effort ? ['--effort', effort] : []),
        ],
        input: `${JSON.stringify({ event: 'user', message: { role: 'user', content: firstMessage(turn) } })}\n`,
      };
    case 'opencode':
      return { args: ['run', '--format', 'json', '--model', route.model, '--agent', 'plan', ...(turn.sessionId ? ['--session', turn.sessionId] : [])], input: firstMessage(turn) };
  }
}

/** The answer text, the session id to resume next time, and usage, from each CLI's output. */
export function readCliChat(kind: ChatCliKind, stdout: string, fallbackId: string): CliChatResult {
  const events = lines(stdout);
  if (kind === 'claude' || kind === 'grok') {
    // Claude Code prints one JSON line ({result, session_id, is_error}); Grok one pretty-printed object ({text, sessionId}).
    let whole: Record<string, unknown> | undefined;
    try {
      whole = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      whole = events.findLast((event) => event.type === 'result');
    }
    if (!whole) throw failure(stdout.slice(-300) || '응답이 없습니다.');
    if (whole.is_error) throw failure(String(whole.result ?? whole.subtype ?? '오류').slice(0, 300));
    return { sessionId: String(whole.session_id ?? whole.sessionId ?? fallbackId), text: String(whole.result ?? whole.text ?? ''), usage: usageOf(whole.usage, whole.total_cost_usd) };
  }
  if (kind === 'codex') {
    const thread = events.find((event) => event.type === 'thread.started');
    const failed = events.find((event) => event.type === 'turn.failed' || event.type === 'error');
    if (failed) throw failure(JSON.stringify(failed.error ?? failed.message ?? failed).slice(0, 300));
    const messages = events.flatMap((event) => {
      const item = event.item as Record<string, unknown> | undefined;
      return event.type === 'item.completed' && item?.type === 'agent_message' ? [String(item.text ?? '')] : [];
    });
    const done = events.findLast((event) => event.type === 'turn.completed');
    return { sessionId: String(thread?.thread_id ?? fallbackId), text: messages.join('\n\n'), usage: usageOf(done?.usage) };
  }
  if (kind === 'antigravity') {
    const init = events.find((event) => event.event === 'init');
    const result = events.findLast((event) => event.event === 'result')?.result as Record<string, unknown> | undefined;
    if (!result || result.status !== 'SUCCESS') throw failure(String(result?.error ?? stdout.slice(-300)));
    return { sessionId: String(init?.conversation_id ?? result.conversation_id ?? fallbackId), text: String(result.response ?? ''), usage: usageOf(result.usage), totals: usageOf(result.usage) };
  }
  const error = events.find((event) => event.type === 'error');
  if (error) throw failure(JSON.stringify(error.error ?? error).slice(0, 300));
  const parts = events.map((event) => event.part as Record<string, unknown> | undefined);
  const sessionId = String(events.map((event) => event.sessionID ?? (event.part as Record<string, unknown> | undefined)?.sessionID).find(Boolean) ?? fallbackId);
  const text = parts.flatMap((part) => (part?.type === 'text' && typeof part.text === 'string' ? [part.text] : [])).join('');
  return { sessionId, text, usage: opencodeUsage(events) };
}

/** Runs one turn in an empty working folder, so the agent sees no files of ours. */
export async function cliChat(route: ResolvedRoute, turn: CliChatTurn): Promise<CliChatResult> {
  const kind = route.kind as ChatCliKind;
  if (!CHAT_CLI_KINDS.includes(kind)) throw new ModelError('config', `${route.kind} 연결은 CLI 채팅을 지원하지 않습니다.`, false);
  const newId = randomUUID();
  const cwd = await mkdtemp(path.join(tmpdir(), 'loca-chat-'));
  const idleMs = idleTimeout(kind, turn.timeoutMs);
  const idle = new AbortController();
  let watchdog: ReturnType<typeof watchIdle> | undefined;
  try {
    const instructionsFile = path.join(cwd, 'instructions.md');
    if (kind === 'codex') await writeFile(instructionsFile, turn.system);
    const { args, input } = cliChatCommand(kind, route, turn, newId, instructionsFile);
    const subprocess = execaCli(cliCommand(kind, route.executable), args, { cwd, input, timeout: turn.timeoutMs, cancelSignal: turn.signal ? AbortSignal.any([turn.signal, idle.signal]) : idle.signal, reject: false, stripFinalNewline: false });
    watchdog = watchIdle([subprocess.stdout, subprocess.stderr], idleMs, () => idle.abort());
    const result = await subprocess;
    if (turn.signal?.aborted) throw new ModelError('cancelled', '중단했습니다.', false);
    if (result.isCanceled) throw watchdog.fired() ? new ModelError('timeout', idleMessage(idleMs)) : new ModelError('cancelled', '중단했습니다.', false);
    if (result.timedOut) throw new ModelError('timeout', 'CLI 응답 시간이 초과되었습니다.');
    const stdout = String(result.stdout ?? '');
    if (result.exitCode !== 0 && !stdout.trim()) throw failure(String(result.stderr ?? '').slice(-300) || `종료 코드 ${result.exitCode}`);
    const answer = readCliChat(kind, stdout, turn.sessionId ?? newId);
    return answer.totals ? { ...answer, usage: turnShare(answer.totals, turn.sessionId ? turn.totalsBefore : undefined) } : answer;
  } catch (error) {
    if (error instanceof ModelError) throw error;
    if (watchdog?.fired()) throw new ModelError('timeout', idleMessage(idleMs));
    if (error instanceof ExecaError && error.code === 'ENOENT') throw new ModelError('config', cliMissing(cliCommand(kind, route.executable)), false);
    throw failure(error instanceof Error ? error.message : String(error));
  } finally {
    watchdog?.stop();
    await rm(cwd, { recursive: true, force: true });
  }
}
