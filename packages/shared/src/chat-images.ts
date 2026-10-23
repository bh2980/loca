/**
 * Images in the project chat: what a message may carry, whether the chosen model takes them, and
 * the "문맥 N%" meter. Shared so the composer, the server and the tests decide the same way.
 */

/** Most bytes one attached image may have (after the browser shrinks it). */
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Most images one message may carry. */
export const CHAT_IMAGES_MAX = 4;
/** The longest side an attached image keeps; larger ones are scaled down in the browser. */
export const CHAT_IMAGE_MAX_SIDE = 2000;
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const IMAGE_UNSUPPORTED_NOTE = '이 모델은 이미지를 받지 않습니다';

/** Decoded size of a `data:` URL, or null when it is not a base64 data URL. */
export function dataUrlBytes(url: string): number | null {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/]*)(={0,2})$/.exec(url);
  if (!match) return null;
  return Math.floor((match[1]!.length * 3) / 4);
}

/** The media type and base64 payload of a `data:` URL. */
export function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match ? { mediaType: match[1]!, data: match[2]! } : null;
}

/** Why an attached image cannot be sent, or null when it can. */
export function imageProblem(file: { mediaType: string; url: string }): string | null {
  if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(file.mediaType)) return `${file.mediaType || '알 수 없는'} 형식은 보낼 수 없습니다 (PNG·JPEG·GIF·WebP만).`;
  const bytes = dataUrlBytes(file.url);
  if (bytes === null) return '이미지 데이터를 읽을 수 없습니다.';
  if (bytes > CHAT_IMAGE_MAX_BYTES) return `이미지가 ${Math.round(CHAT_IMAGE_MAX_BYTES / 1024 / 1024)}MB를 넘습니다.`;
  return null;
}

/**
 * Whether the images of a message go to the model. `known` is what the connection said about the
 * model (the model list's input modalities, or the agent CLI's promptCapabilities.image):
 * false means it takes none, so the text is sent without them; unknown is tried (the provider's
 * error then shows).
 */
export function imageDecision(known: boolean | undefined, count: number) {
  const support = known === undefined ? ('unknown' as const) : known ? ('yes' as const) : ('no' as const);
  return { support, send: count > 0 && known !== false, dropped: known === false ? count : 0 };
}

/**
 * The share of the model's window the last answer's input used, as the "문맥 N%" meter shows it.
 * Null (the meter hides) when the window or the input is unknown.
 */
export function contextMeter(input: { inputTokens: number | null | undefined; window: number | null | undefined }) {
  if (!input.window || input.window <= 0 || input.inputTokens === null || input.inputTokens === undefined) return null;
  const ratio = input.inputTokens / input.window;
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  return { percent, tokens: input.inputTokens, window: input.window, level: percent >= 90 ? ('full' as const) : percent >= 70 ? ('high' as const) : ('ok' as const) };
}

/**
 * Where the conversation's start was summarized (chat-compaction.ts stores `upTo`: messages before
 * it are in the summary), as the panel marks it: before the message at `index`. Null when there
 * is none or it no longer points into the record.
 */
export function compactionMarker(compaction: { upTo: number; summary: string; at: number } | null | undefined, messageCount: number) {
  if (!compaction || compaction.upTo <= 0 || compaction.upTo >= messageCount) return null;
  return { index: compaction.upTo, summary: compaction.summary, at: compaction.at };
}
