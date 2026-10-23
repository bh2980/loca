import type { UIMessage } from 'ai';

/**
 * Model context built from the one conversation record (`chat_sessions.messages`).
 * Every backend reads the same record, whole: the API chat sends it as messages, a CLI gets it as
 * text. A CLI's own session (on disk) is only a cache that remembers how much of the record it has
 * seen; what it missed is handed over from here (#46). Nothing is shortened here: a record that
 * outgrows the model's window is compacted (chat-compaction.ts).
 */

/** Who answered: kept on every assistant message, so a switch mid-conversation stays visible. */
export interface AnsweredBy {
  kind: string;
  connectionId: string;
  model: string;
}

export const textOf = (message: UIMessage) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');

const json = (value: unknown) => {
  if (value === undefined || value === null) return '';
  return (typeof value === 'string' ? value : JSON.stringify(value)) ?? '';
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
function toolLine(part: ToolPart) {
  const name = part.toolName ?? part.type.replace(/^tool-/, '');
  const result = part.state === 'output-error' ? ` → 실패: ${json(part.errorText)}` : part.state === 'output-available' ? ` → ${json(part.output)}` : part.state === 'output-denied' ? ' → 거절됨' : '';
  return `[도구 ${name} ${json(part.input)}${result}]`;
}

/** One message as text: what was said plus the tools it used and what they returned. */
export function messageText(message: UIMessage) {
  const pieces: string[] = [];
  for (const part of message.parts) {
    if (part.type === 'text' && part.text.trim()) pieces.push(part.text);
    else if (part.type === 'file') pieces.push('[이미지 첨부]');
    else if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') pieces.push(toolLine(part as ToolPart));
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

/** The conversation as text, every message whole, naming who answered. */
export function transcript(messages: UIMessage[]) {
  return expandSteers(messages)
    .map((message) => ({ who: speaker(message), text: messageText(message) }))
    .filter((line) => line.text)
    .map((line) => `${line.who}: ${line.text}`)
    .join('\n');
}

/** The whole earlier conversation for a backend that starts fresh (a new CLI session, another model). */
export function handover(earlier: UIMessage[]) {
  const text = transcript(earlier);
  return text ? `이 대화의 이전 기록(다른 AI와 나눈 부분 포함, 이어서 대화하세요):\n${text}` : null;
}

/** What a backend's cached session missed: messages after the ones it saw (another model answered in between). */
export function catchUp(earlier: UIMessage[], seen: number) {
  const missed = earlier.slice(Math.max(0, Math.min(seen, earlier.length)));
  const text = transcript(missed);
  return text ? `지난번 이후 이 대화에서 오간 내용(다른 AI가 답한 부분):\n${text}` : null;
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
