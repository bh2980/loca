import { APICallError, NoObjectGeneratedError } from 'ai';
import { describe, expect, it } from 'vitest';
import { toModelError } from './errors.ts';

const apiError = (statusCode: number, message: string, responseBody?: string) => new APICallError({ message, url: 'http://x', requestBodyValues: {}, statusCode, responseBody, isRetryable: false });

describe('toModelError', () => {
  it('tells a request longer than the context window from other rejected requests', () => {
    expect(toModelError(apiError(400, 'Bad Request', JSON.stringify({ error: { message: "This model's maximum context length is 128000 tokens." } }))).code).toBe('too-long');
    expect(toModelError(apiError(413, 'Payload Too Large')).code).toBe('too-long');
    expect(toModelError(apiError(400, 'Invalid schema')).code).toBe('config');
    expect(toModelError(new Error('prompt is too long: 220000 tokens > 200000 maximum')).code).toBe('too-long');
    expect(toModelError(new Error('socket hang up')).code).toBe('unknown');
  });

  it('reads why there is no object from the finish reason: the output limit is cut-off, a content filter a refusal', () => {
    const noObject = (finishReason: 'length' | 'content-filter' | 'stop') => new NoObjectGeneratedError({ message: 'could not parse', text: '{"results":[', response: { id: 'r', timestamp: new Date(), modelId: 'm' }, usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13, inputTokenDetails: {}, outputTokenDetails: {} } as never, finishReason: finishReason as never });
    expect(toModelError(noObject('length')).code).toBe('cut-off');
    expect(toModelError(noObject('content-filter')).code).toBe('refused');
    expect(toModelError(noObject('stop')).code).toBe('invalid-output');
    expect(toModelError(noObject('length')).usage).toMatchObject({ inputTokens: 9, outputTokens: 4 });
    // A provider's content filter that rejects the request itself says so by its error code.
    expect(toModelError(apiError(400, 'Bad Request', JSON.stringify({ error: { code: 'content_filter', message: 'The response was filtered' } }))).code).toBe('refused');
  });

  it('keeps a token rate limit a rate limit', () => {
    expect(toModelError(apiError(429, 'Rate limit reached for tokens per min')).code).toBe('rate-limit');
  });
});
