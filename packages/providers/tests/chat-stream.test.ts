import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeChat, ProviderError, type ChatRequest } from '../src/index.ts';
import { SSEDecoder } from '../src/chat-stream.ts';

const base: ChatRequest = { connection: { id: 'fake', name: 'Fake', kind: 'openai', baseUrl: 'http://127.0.0.1:9999/v1', apiMode: 'chat', allowUnauthenticated: true }, profile: { connectionId: 'fake', model: 'fake', effort: '', timeoutMs: 1000, maxOutputTokens: 100, maxAttempts: 1 }, messages: [{ role: 'user', content: 'test' }], stream: true, tools: [{ name: 'read', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }] };
const frame = (data: unknown) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`;
const chunk = (delta: unknown, finish: unknown = null) => ({ model: 'fake', choices: [{ index: 0, delta, finish_reason: finish }] });
function fake(events: unknown[], inspect?: (body: Record<string, unknown>) => void): typeof fetch {
  return (async (_input, init) => {
    inspect?.(JSON.parse(String(init?.body)));
    const bytes = new TextEncoder().encode(': heartbeat\r\n\r\n' + events.map(frame).join(''));
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  }) as typeof fetch;
}
const isCode = (...codes: string[]) => (error: unknown) => error instanceof ProviderError && codes.includes(error.code);
const tools = [chunk({ role: 'assistant', content: '조사', tool_calls: [{ index: 0, id: 'call1', type: 'function', function: { name: 'read', arguments: '{"id":' } }] }), chunk({ content: ' 중', tool_calls: [{ index: 0, function: { arguments: '"source"}' } }] }), chunk({}, 'tool_calls'), { model: 'fake', choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }, '[DONE]'];

test('split UTF8/CRLF Chat SSE assembles text, stable tools and usage without partial tool exposure', async () => {
  const texts: string[] = [];
  const result = await invokeChat({ ...base, onText: text => texts.push(text) }, { fetch: fake(tools, body => { assert.equal(body.stream, true); assert.deepEqual(body.stream_options, { include_usage: true }); }) });
  assert.deepEqual(texts, ['조사', '조사 중']); assert.equal(result.message, '조사 중'); assert.deepEqual(result.toolCalls, [{ id: 'call1', name: 'read', arguments: { id: 'source' } }]); assert.equal(result.usage?.totalTokens, 7);
});

test('JSON response remains compatible when stream requested and makes just one HTTP request', async () => {
  let calls = 0;
  const result = await invokeChat(base, { fetch: (async () => { calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'JSON server' } }] }), { headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch });
  assert.equal(calls, 1); assert.equal(result.message, 'JSON server');
});

test('incomplete or malformed Chat SSE never returns tool calls and never retries', async () => {
  const cases = [tools.slice(0, 2), tools.slice(0, -1), [chunk({ tool_calls: [{ index: 0, id: 'x', type: 'function', function: { name: 'read', arguments: '{"id":' } }] }), chunk({}, 'tool_calls'), '[DONE]'], [chunk({ tool_calls: [{ index: 0, id: 'x', type: 'function', function: { name: 'read', arguments: '{"bad":1}' } }] }), chunk({}, 'tool_calls'), '[DONE]'], [chunk({ content: 'partial' }), chunk({}, 'length'), '[DONE]'], [chunk({ content: 'partial' }), { error: { message: 'failure' } }]];
  for (const events of cases) { let calls = 0; const fetcher = fake(events); await assert.rejects(invokeChat(base, { fetch: ((...args) => { calls++; return fetcher(...args); }) as typeof fetch }), isCode('incomplete-response', 'invalid-json', 'invalid-tool-arguments', 'invalid-stream')); assert.equal(calls, 1); }
});

test('Chat SSE rejects changed tool identity, unknown tools, missing indices and excessive arguments', async () => {
  for (const [events, codes] of [
    [[tools[0], chunk({ tool_calls: [{ index: 0, id: 'other' }] })], ['invalid-stream']],
    [[chunk({ tool_calls: [{ index: 1, id: 'x', type: 'function', function: { name: 'read', arguments: '{"id":"a"}' } }] }), chunk({}, 'tool_calls'), '[DONE]'], ['invalid-stream']],
    [[chunk({ tool_calls: [{ index: 0, id: 'x', type: 'function', function: { name: 'unknown', arguments: '{}' } }] }), chunk({}, 'tool_calls'), '[DONE]'], ['unknown-tool']],
    [[chunk({ tool_calls: [{ index: 0, id: 'x', type: 'function', function: { name: 'read', arguments: 'x'.repeat(65537) } }] })], ['output-limit']],
  ] as [unknown[], string[]][]) await assert.rejects(invokeChat(base, { fetch: fake(events) }), isCode(...codes));
});

const output = [ { type: 'reasoning', id: 'rs1', summary: [], encrypted_content: 'opaque' }, { type: 'message', id: 'msg1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '완료' }] }, { type: 'function_call', id: 'item1', call_id: 'call1', name: 'read', arguments: '{"id":"source"}', status: 'completed' } ];
const responsesEvents = [ { type: 'response.created', response: { status: 'in_progress' } }, { type: 'response.output_text.delta', item_id: 'msg1', output_index: 1, content_index: 0, delta: '완' }, { type: 'response.output_text.delta', item_id: 'msg1', output_index: 1, content_index: 0, delta: '료' }, { type: 'response.function_call_arguments.delta', item_id: 'item1', output_index: 2, delta: '{"id":' }, { type: 'response.function_call_arguments.delta', item_id: 'item1', output_index: 2, delta: '"source"}' }, { type: 'response.function_call_arguments.done', item_id: 'item1', output_index: 2, arguments: '{"id":"source"}' }, { type: 'response.completed', response: { status: 'completed', output, model: 'fake', usage: { input_tokens: 8, output_tokens: 4 } } } ];
const responsesBase = { ...base, connection: { ...base.connection, apiMode: 'responses' as const } };
test('Responses SSE waits for completed envelope, preserves encrypted replay and call_id', async () => {
  const text: string[] = [];
  const result = await invokeChat({ ...responsesBase, onText: value => text.push(value) }, { fetch: fake(responsesEvents) });
  assert.deepEqual(text, ['완', '완료']); assert.deepEqual(result.responseItems, output); assert.equal(result.toolCalls[0].id, 'call1'); assert.equal(result.usage?.outputTokens, 4);
});
test('Responses SSE rejects incomplete, failed and mismatching final arguments', async () => {
  const changed = structuredClone(responsesEvents); (changed.at(-1) as typeof responsesEvents[number]).response!.output![2].arguments = '{}';
  for (const events of [responsesEvents.slice(0, -1), [responsesEvents[1], { type: 'response.failed', response: { status: 'failed' } }], changed]) await assert.rejects(invokeChat(responsesBase, { fetch: fake(events) }), isCode('invalid-stream', 'incomplete-response'));
});
test('SSE framing supports multiline data, rejects unfinished frames and invalid UTF8', () => {
  const frames: string[] = [], decoder = new SSEDecoder(text => frames.push(text));
  decoder.feed(new TextEncoder().encode('event: message\ndata: {"value":\ndata: "ok"}\n\n')); decoder.end(); assert.deepEqual(frames, ['{"value":\n"ok"}']);
  const truncated = new SSEDecoder(() => {}); truncated.feed(new TextEncoder().encode('data: {}')); assert.throws(() => truncated.end(), isCode('incomplete-response'));
  assert.throws(() => new SSEDecoder(() => {}).feed(Uint8Array.of(255)), isCode('invalid-stream'));
});
test('cancellation after text delta aborts a hanging reader without returning partial tools', async () => {
  const controller = new AbortController(); let text = '';
  await assert.rejects(invokeChat({ ...base, signal: controller.signal, onText: value => { text = value; controller.abort(); } }, { fetch: (async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode(frame(chunk({ content: '보존' })))); } }), { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch }), isCode('cancelled'));
  assert.equal(text, '보존');
});
