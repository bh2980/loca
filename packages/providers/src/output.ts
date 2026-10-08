import { Ajv } from 'ajv';
import { ProviderError, type ProviderUsage } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });

export function parseJson(text: string): unknown {
  const clean = text.replace(/^\uFEFF/, '').trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(clean);
  try { return JSON.parse(fenced?.[1] ?? clean); }
  catch { throw new ProviderError('invalid-json', '모델의 최종 응답이 올바른 JSON이 아닙니다.'); }
}

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

// Grok Build 1.0.30 --output-format json uses a camelCase terminal envelope.
// Require terminal metadata so a bare text/progress object is not unwrapped.
function isGrokResult(value: unknown): boolean {
  const result = object(value);
  return typeof result?.sessionId === 'string' && typeof result.requestId === 'string'
    && typeof result.stopReason === 'string' && result.stopReason.length > 0
    && Number.isInteger(result.num_turns) && (result.num_turns as number) > 0;
}

export function validateOutput(data: unknown, schema: Record<string, unknown>): unknown {
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    const locations = (validate.errors ?? []).slice(0, 5).map((error) => `${error.instancePath || '/'}: ${error.keyword}`).join(', ');
    throw new ProviderError('schema-mismatch', `모델 응답이 작업 스키마와 일치하지 않습니다 (${locations}).`);
  }
  return data;
}

/** Only terminal results are accepted; a progress event is never a successful model result. */
export function parseCliOutput(text: string, schema: Record<string, unknown>): { data: unknown; envelope?: Record<string, unknown> } {
  let parsed: unknown;
  try { parsed = parseJson(text); }
  catch {
    const events: unknown[] = [];
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      try { events.push(JSON.parse(line)); } catch { /* banners are not model output */ }
    }
    parsed = events.findLast((event) => object(event)?.type === 'result' || isGrokResult(event));
    if (!parsed) throw new ProviderError('missing-result', 'CLI가 최종 JSON 결과를 반환하지 않았습니다.');
  }
  const envelope = object(parsed);
  if (envelope?.is_error === true || envelope?.type === 'error' ||
      (typeof envelope?.subtype === 'string' && envelope.subtype.startsWith('error'))) {
    throw new ProviderError('cli-result-error', 'CLI가 작업 실패 결과를 반환했습니다.');
  }
  if (envelope?.type && ['system', 'assistant', 'user', 'stream_event', 'item.completed', 'turn.completed'].includes(String(envelope.type))) {
    throw new ProviderError('missing-result', 'CLI 진행 이벤트를 최종 결과로 사용할 수 없습니다.');
  }
  if (isGrokResult(envelope)) {
    if (envelope!.type !== undefined && envelope!.type !== 'result') {
      throw new ProviderError('missing-result', 'CLI 진행 이벤트를 최종 결과로 사용할 수 없습니다.');
    }
    const stopReason = String(envelope!.stopReason).toLowerCase().replace(/[ -]/g, '_');
    if (/error|fail|cancel|abort/.test(stopReason)) {
      throw new ProviderError('cli-result-error', 'CLI가 작업 실패 결과를 반환했습니다.');
    }
    if (/truncat|length|max_?(tokens?|turns?)|token_?limit|context_?limit/.test(stopReason)) {
      throw new ProviderError('incomplete-response', 'CLI 응답이 제한에 도달해 완성되지 않았습니다.');
    }
    // Prefer the CLI's schema output over text. Never fall back to text when an
    // explicit structured result exists but fails validation.
    const result = envelope!.structuredOutput !== undefined ? envelope!.structuredOutput
      : typeof envelope!.text === 'string' ? parseJson(envelope!.text) : undefined;
    return { data: validateOutput(result, schema), envelope };
  }
  if (envelope?.structured_output !== undefined) {
    if (envelope.type !== 'result' || (envelope.subtype !== undefined && envelope.subtype !== 'success')) {
      throw new ProviderError('missing-result', 'CLI의 완료된 결과가 아닌 구조화 출력을 사용할 수 없습니다.');
    }
    return { data: validateOutput(envelope.structured_output, schema), envelope };
  }
  if (envelope?.result !== undefined && (envelope.type === 'result' || envelope.is_error !== undefined || envelope.session_id !== undefined)) {
    const result = typeof envelope.result === 'string' ? parseJson(envelope.result) : envelope.result;
    return { data: validateOutput(result, schema), envelope };
  }
  return { data: validateOutput(parsed, schema), envelope };
}

export function normalizeUsage(raw: unknown): ProviderUsage | undefined {
  const usage = object(raw);
  if (!usage) return undefined;
  const numeric = (...values: unknown[]) => values.find((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0) as number | undefined;
  const result: ProviderUsage = {
    inputTokens: numeric(usage.input_tokens, usage.prompt_tokens, usage.inputTokens),
    outputTokens: numeric(usage.output_tokens, usage.completion_tokens, usage.outputTokens),
    cachedInputTokens: numeric(usage.cached_input_tokens, usage.cache_read_input_tokens, object(usage.prompt_tokens_details)?.cached_tokens, object(usage.input_tokens_details)?.cached_tokens),
    totalTokens: numeric(usage.total_tokens, usage.totalTokens),
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}
