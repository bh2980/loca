/**
 * Chat tools can return far more than a model should read in one step (a 50k-line game's term
 * list, every check finding). Every chat path (API, CLI) sends a tool result through
 * `fitResult`, so the model always learns that it got part of it and how to get the rest, instead
 * of each path cutting the text silently at its own length.
 */
export const TOOL_RESULT_CHARS = 30_000;

export interface Truncation {
  shown: number;
  total: number;
  note: string;
}

const NOTE = '결과가 길어 앞부분만 보냅니다. offset·limit이나 더 좁은 조건으로 나머지를 보세요.';
const size = (value: unknown) => (JSON.stringify(value) ?? 'null').length;

/** The longest prefix of `list` whose wrapped form still fits. */
function fitList<T>(list: T[], wrap: (part: T[], truncated: Truncation) => unknown, limit: number) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (size(wrap(list.slice(0, mid), { shown: mid, total: list.length, note: NOTE })) <= limit) low = mid;
    else high = mid - 1;
  }
  return wrap(list.slice(0, low), { shown: low, total: list.length, note: NOTE });
}

export function fitResult(result: unknown, limit = TOOL_RESULT_CHARS): unknown {
  if (size(result) <= limit) return result;
  if (Array.isArray(result)) return fitList(result, (items, truncated) => ({ items, truncated }), limit);
  if (result && typeof result === 'object') {
    // Shorten the object's longest list (lines, items, terms…) and say so next to it.
    const record = result as Record<string, unknown>;
    const key = Object.keys(record)
      .filter((name) => Array.isArray(record[name]))
      .sort((a, b) => size(record[b]) - size(record[a]))[0];
    if (key) {
      const fitted = fitList(record[key] as unknown[], (part, truncated) => ({ ...record, [key]: part, truncated }), limit);
      if (size(fitted) <= limit) return fitted;
    }
  }
  const text = JSON.stringify(result) ?? String(result);
  return { text: text.slice(0, limit - 200), truncated: { shown: limit - 200, total: text.length, note: '결과가 길어 앞부분 글자만 보냅니다. 더 좁은 조건으로 다시 부르세요.' } };
}

/** A tool result as text for a chat that takes text (CLI). */
export const fitText = (result: unknown, limit = TOOL_RESULT_CHARS) => JSON.stringify(fitResult(result, limit));

/** The API chat's tools with every result passed through `fitResult` (the SDK hands results to the model as they are). */
export function withFittedResults<T extends Record<string, { execute?: (...args: never[]) => unknown }>>(tools: T): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute;
      if (!execute) return [name, tool];
      return [name, { ...tool, execute: async (...args: never[]) => fitResult(await execute(...args)) }];
    }),
  ) as T;
}
