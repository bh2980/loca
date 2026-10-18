import type { UIMessage } from 'ai';

/**
 * Model context built from the one conversation record (`chat_sessions.messages`).
 * Every backend reads the same record: the API chat sends it as messages, pi is seeded with it, a
 * CLI gets it as text. A backend's own session (pi in memory, a CLI on disk) is only a cache that
 * remembers how much of the record it has seen; what it missed is handed over from here (#46).
 */

/** Who answered: kept on every assistant message, so a switch mid-conversation stays visible. */
export interface AnsweredBy {
  kind: string;
  connectionId: string;
  model: string;
}

/** Characters of earlier conversation each backend gets before older parts are shortened. */
export const CONTEXT_BUDGET = { api: 200_000, pi: 200_000, cli: 120_000 } as const;
/** An old message shortened to fit the budget keeps this much of its text. */
const SHORT = 300;

export const textOf = (message: UIMessage) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);
const json = (value: unknown, limit: number) => {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return clip(text ?? '', limit);
};

interface ToolPart {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/** A tool call and its result on one line, for a reader that cannot take the structured parts. */
function toolLine(part: ToolPart, limit: number) {
  const name = part.toolName ?? part.type.replace(/^tool-/, '');
  const result = part.state === 'output-error' ? ` → 실패: ${json(part.errorText, limit)}` : part.state === 'output-available' ? ` → ${json(part.output, limit)}` : part.state === 'output-denied' ? ' → 거절됨' : '';
  return `[도구 ${name} ${json(part.input, Math.min(limit, 400))}${result}]`;
}

/** One message as text: what was said plus the tools it used (results shortened). */
export function messageText(message: UIMessage, limit = 2_000) {
  const pieces: string[] = [];
  for (const part of message.parts) {
    if (part.type === 'text' && part.text.trim()) pieces.push(part.text);
    else if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') pieces.push(toolLine(part as ToolPart, limit));
  }
  return pieces.join('\n');
}

/** A message the person sent while the reply was running, kept inside that reply where it reached the model (#44). */
export interface SteerPart {
  type: 'data-steer';
  data: { text: string };
}
export const isSteer = (part: { type: string }): part is SteerPart => part.type === 'data-steer';

/**
 * The record with each reply split where a steering message reached the model: reply so far, the
 * person's message, the rest of the reply. Context builders read this, so every backend sees the
 * conversation in the order it happened.
 */
export function expandSteers(messages: UIMessage[]): UIMessage[] {
  if (!messages.some((message) => message.role === 'assistant' && message.parts.some(isSteer))) return messages;
  return messages.flatMap((message) => {
    if (message.role !== 'assistant' || !message.parts.some(isSteer)) return [message];
    const out: UIMessage[] = [];
    let parts: UIMessage['parts'] = [];
    const flush = () => {
      if (parts.some((part) => part.type !== 'step-start')) out.push({ ...message, id: out.length ? `${message.id}~${out.length}` : message.id, parts });
      parts = [];
    };
    for (const part of message.parts) {
      if (isSteer(part)) {
        flush();
        out.push({ id: `${message.id}~${out.length}`, role: 'user', parts: [{ type: 'text', text: part.data.text }] });
      } else parts.push(part);
    }
    flush();
    return out;
  });
}

const speaker = (message: UIMessage) => {
  if (message.role === 'user') return '사용자';
  const by = (message.metadata as { answeredBy?: AnsweredBy } | undefined)?.answeredBy;
  return by ? `에이전트(${by.model})` : '에이전트';
};

/**
 * The conversation as text within `budget` characters. Recent messages stay whole; older ones are
 * shortened, and if that is still too long the oldest are left out with a note saying how many.
 */
export function transcript(messages: UIMessage[], budget: number) {
  const full = expandSteers(messages).map((message) => ({ who: speaker(message), text: messageText(message) })).filter((line) => line.text);
  if (!full.length) return '';
  const lines: string[] = [];
  let used = 0;
  let index = full.length - 1;
  // Newest first: whole while they fit in most of the budget, then shortened.
  for (; index >= 0; index--) {
    const line = `${full[index].who}: ${full[index].text}`;
    if (used + line.length > budget * 0.7) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  for (; index >= 0; index--) {
    const line = `${full[index].who}: ${clip(full[index].text, SHORT)}`;
    if (used + line.length > budget) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  if (index >= 0) lines.unshift(`(앞선 메시지 ${index + 1}개는 길이 때문에 생략)`);
  return lines.join('\n');
}

/** The whole earlier conversation for a backend that starts fresh (a new CLI or pi session, another model). */
export function handover(earlier: UIMessage[], budget: number) {
  const text = transcript(earlier, budget);
  return text ? `이 대화의 이전 기록(다른 AI와 나눈 부분 포함, 이어서 대화하세요):\n${text}` : null;
}

/** What a backend's cached session missed: messages after the ones it saw (another model answered in between). */
export function catchUp(earlier: UIMessage[], seen: number, budget: number) {
  const missed = earlier.slice(Math.max(0, Math.min(seen, earlier.length)));
  const text = transcript(missed, budget);
  return text ? `지난번 이후 이 대화에서 오간 내용(다른 AI가 답한 부분):\n${text}` : null;
}

const sizeOf = (message: UIMessage) => JSON.stringify(message.parts).length;

/**
 * The record as API messages within `budget` characters: when it is longer, the older part becomes
 * one text message (a handover) and the rest is sent as it is, starting at a user message so a tool
 * call is never cut from its result (pi's compaction keeps the same boundary).
 */
export function fitMessages(record: UIMessage[], budget: number): UIMessage[] {
  const messages = expandSteers(record);
  let total = messages.reduce((sum, message) => sum + sizeOf(message), 0);
  if (total <= budget) return messages;
  let start = 0;
  while (start < messages.length - 1 && total > budget * 0.7) {
    total -= sizeOf(messages[start]);
    start++;
  }
  while (start > 0 && messages[start].role !== 'user') start--;
  if (start === 0) return messages;
  const summary = handover(messages.slice(0, start), budget * 0.3);
  if (!summary) return messages.slice(start);
  return [{ id: 'earlier', role: 'user', parts: [{ type: 'text', text: summary }] }, ...messages.slice(start)];
}

/**
 * Puts a message the browser sent into the stored record. The server owns the record: a new message
 * is appended, a message it already has (an assistant message with a tool approval answered) replaces
 * the stored one by id, and a regenerate drops the answers after the last user message.
 */
export function mergeIncoming(stored: UIMessage[], incoming: UIMessage | undefined, trigger: 'submit-message' | 'regenerate-message' = 'submit-message'): UIMessage[] {
  let messages = [...stored];
  if (trigger === 'regenerate-message') {
    while (messages.length && messages.at(-1)!.role === 'assistant') messages.pop();
  }
  if (!incoming) return messages;
  const at = messages.findIndex((message) => message.id === incoming.id);
  if (at >= 0) {
    // Only the newest message may be revised (an approval answered on the reply in progress).
    if (at < messages.length - 1) return messages;
    messages[at] = incoming;
  } else messages = [...messages, incoming];
  return messages;
}
