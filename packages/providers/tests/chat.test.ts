import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeChat, chatCapability, ProviderError, type ChatRequest } from '../src/index.ts';

const base: ChatRequest = {
  connection: { id: 'api', name: 'LAN', kind: 'openai', baseUrl: 'http://192.168.0.36:8080/v1', apiMode: 'chat', allowUnauthenticated: true },
  profile: { connectionId: 'api', model: 'test-model', effort: '', timeoutMs: 1000, maxOutputTokens: 100, maxAttempts: 1 },
  messages: [{ role: 'system', content: 'Read project data.' }, { role: 'user', content: 'Find the scene.' }],
  tools: [{ name: 'search_source', description: 'Search local sources', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }],
};
const call = { id: 'call_stable_1', type: 'function', function: { name: 'search_source', arguments: '{"query":"scene"}' } };
const completion = (message: unknown = { role: 'assistant', content: null, tool_calls: [call] }, finish = 'tool_calls') => ({ model: 'reported-model', choices: [{ finish_reason: finish, message }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_tokens_details: { cached_tokens: 3 } } });
function fake(data: unknown, inspect?: (url: string, init: RequestInit) => void): typeof fetch {
  return (async (input, init) => { inspect?.(String(input), init!); return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
}
const code = (expected: string) => (error: unknown) => error instanceof ProviderError && error.code === expected;

test('chat turn sends function schema and normalizes stable IDs, JSON args and usage', async () => {
  const result = await invokeChat({ ...base, credential: 'memory-secret' }, { fetch: fake(completion(), (url, init) => {
    assert.equal(url, base.connection.baseUrl + '/chat/completions');
    assert.equal(init.redirect, 'error'); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer memory-secret');
    const body = JSON.parse(init.body as string);
    assert.deepEqual(body.messages, base.messages); assert.equal(body.stream, false); assert.equal(body.store, false);
    assert.equal(body.tools[0].type, 'function'); assert.equal(body.tools[0].function.strict, false);
    assert.equal(body.max_completion_tokens, 100); assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.response_format, undefined);
  }) });
  assert.equal(result.message, ''); assert.equal(result.reportedModel, 'reported-model');
  assert.deepEqual(result.toolCalls, [{ id: call.id, name: call.function.name, arguments: { query: 'scene' } }]);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 3 });
});

test('chat history serializes matching results and supports plain text final answers', async () => {
  const first = await invokeChat(base, { fetch: fake(completion()) });
  const request: ChatRequest = { ...base, connection: { ...base.connection, tokenLimitField: 'max_tokens' }, profile: { ...base.profile, effort: 'low' }, messages: [...base.messages,
    { role: 'assistant', content: first.message, toolCalls: first.toolCalls }, { role: 'tool', toolCallId: call.id, content: '{"total":1}' }] };
  const final = await invokeChat(request, { fetch: fake(completion({ role: 'assistant', content: 'Found one scene.' }, 'stop'), (_url, init) => {
    const body = JSON.parse(init.body as string);
    assert.deepEqual(body.messages[2], { role: 'assistant', content: null, tool_calls: [call] });
    assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: call.id, content: '{"total":1}' });
    assert.equal(body.max_tokens, 100); assert.equal(body.reasoning_effort, 'low');
  }) });
  assert.equal(final.message, 'Found one scene.'); assert.deepEqual(final.toolCalls, []);
});

test('Responses preserves call_id, encrypted reasoning and original item ordering for stateless continuation', async () => {
  const output = [
    { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-encrypted-reasoning' },
    { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', phase: 'commentary', content: [{ type: 'output_text', text: 'Searching.', annotations: [] }] },
    { type: 'function_call', id: 'fc_item_not_call_id', call_id: 'call_responses_1', name: 'search_source', arguments: '{"query":"scene"}', status: 'completed' },
  ];
  const request = { ...base, connection: { ...base.connection, apiMode: 'responses' as const }, profile: { ...base.profile, effort: 'medium' } };
  const result = await invokeChat(request, { fetch: fake({ status: 'completed', output, usage: { input_tokens: 10, output_tokens: 4 } }, (url, init) => {
    const body = JSON.parse(init.body as string);
    assert.equal(url, base.connection.baseUrl + '/responses'); assert.deepEqual(body.input, base.messages);
    assert.equal(body.tools[0].name, 'search_source'); assert.equal(body.tools[0].function, undefined);
    assert.equal(body.max_output_tokens, 100); assert.deepEqual(body.reasoning, { effort: 'medium' });
  }) });
  assert.equal(result.message, 'Searching.'); assert.equal(result.toolCalls[0].id, 'call_responses_1');
  assert.deepEqual(result.responseItems, output);
  await invokeChat({ ...request, messages: [...base.messages, { role: 'assistant', content: result.message, toolCalls: result.toolCalls, responseItems: result.responseItems },
    { role: 'tool', toolCallId: result.toolCalls[0].id, content: 'one match' }] }, { fetch: fake({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }] }, (_url, init) => {
    const body = JSON.parse(init.body as string);
    assert.deepEqual(body.input.slice(2, 5), output);
    assert.deepEqual(body.input[5], { type: 'function_call_output', call_id: 'call_responses_1', output: 'one match' });
  }) });
});

test('model tool calls must be allowed, valid JSON objects and match schema', async () => {
  for (const [expected, replacement] of [
    ['unknown-tool', { ...call, function: { ...call.function, name: 'write_project' } }],
    ['invalid-json', { ...call, function: { ...call.function, arguments: '```json\n{}\n```' } }],
    ['invalid-tool-arguments', { ...call, function: { ...call.function, arguments: '[1]' } }],
    ['invalid-tool-arguments', { ...call, function: { ...call.function, arguments: '{"query":42}' } }],
    ['invalid-tool-arguments', { ...call, function: { ...call.function, arguments: '{"query":"x","write":true}' } }],
    ['invalid-tool-call', { ...call, id: '' }],
    ['invalid-tool-call', { ...call, type: 'custom' }],
  ] as const) await assert.rejects(invokeChat(base, { fetch: fake(completion({ role: 'assistant', content: null, tool_calls: [replacement] })) }), code(expected));
  await assert.rejects(invokeChat(base, { fetch: fake(completion({ role: 'assistant', content: null, tool_calls: [call, call] })) }), code('invalid-tool-call'));
  await assert.rejects(invokeChat({ ...base, tools: [] }, { fetch: fake(completion()) }), code('unknown-tool'));
});

test('reused call IDs and mismatched Responses replay cannot introduce hidden tool actions', async () => {
  const result = await invokeChat(base, { fetch: fake(completion()) });
  const messages: ChatRequest['messages'] = [...base.messages, { role: 'assistant', content: '', toolCalls: result.toolCalls }, { role: 'tool', toolCallId: call.id, content: 'done' }];
  await assert.rejects(invokeChat({ ...base, messages }, { fetch: fake(completion()) }), code('invalid-tool-call'));
  let calls = 0;
  const modified: ChatRequest = { ...base, connection: { ...base.connection, apiMode: 'responses' }, messages: [...base.messages,
    { role: 'assistant', content: '', toolCalls: result.toolCalls, responseItems: [{ type: 'function_call', call_id: call.id, name: 'write_project', arguments: '{}' }] },
    { role: 'tool', toolCallId: call.id, content: 'done' }] };
  await assert.rejects(invokeChat(modified, { fetch: fake(completion(), () => { calls++; }) }), code('invalid-tool-history'));
  assert.equal(calls, 0);
});

test('incomplete, refusal, empty and non-function Responses output are rejected', async () => {
  await assert.rejects(invokeChat(base, { fetch: fake(completion({ role: 'assistant', content: 'partial' }, 'length')) }), code('incomplete-response'));
  await assert.rejects(invokeChat(base, { fetch: fake(completion({ role: 'assistant', content: null, refusal: 'no' }, 'stop')) }), code('refusal'));
  await assert.rejects(invokeChat(base, { fetch: fake(completion({ role: 'assistant', content: '' }, 'stop')) }), code('missing-result'));
  await assert.rejects(invokeChat(base, { fetch: fake(completion({ role: 'assistant', content: null }, 'tool_calls')) }), code('invalid-tool-call'));
  const request = { ...base, connection: { ...base.connection, apiMode: 'responses' as const } };
  for (const [expected, response] of [
    ['incomplete-response', { status: 'incomplete', output: [] }],
    ['incomplete-response', { status: 'completed', output: [{ type: 'function_call', status: 'in_progress' }] }],
    ['refusal', { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }] }],
    ['unsupported-response-item', { status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }] }],
  ] as const) await assert.rejects(invokeChat(request, { fetch: fake(response) }), code(expected));
});

test('invalid history, schemas, routing and credentials fail before any network request', async () => {
  let calls = 0; const fetcher = fake(completion(), () => { calls++; });
  for (const [expected, request] of [
    ['invalid-tool-history', { ...base, messages: [...base.messages, { role: 'tool', toolCallId: 'missing', content: 'data' }] }],
    ['invalid-tool-history', { ...base, messages: [...base.messages, { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'search_source', arguments: {} }] }] }],
    ['invalid-tools', { ...base, tools: [base.tools![0], base.tools![0]] }],
    ['invalid-tool-schema', { ...base, tools: [{ name: 'bad', parameters: { type: 'object', properties: { field: { type: 'bad_type' } } } }] }],
    ['profile-connection-mismatch', { ...base, profile: { ...base.profile, connectionId: 'other' } }],
    ['invalid-key', { ...base, credential: 'bad\nsecret' }],
    ['invalid-env-key', { ...base, connection: { ...base.connection, envKey: 'BAD-ENV' } }],
    ['missing-key', { ...base, connection: { ...base.connection, envKey: 'WORKBENCH_FAKE_MISSING_CHAT_KEY_873' } }],
    ['input-limit', { ...base, messages: [{ role: 'user', content: 'a'.repeat(2 * 1024 * 1024) }] }],
  ] as [string, ChatRequest][]) await assert.rejects(invokeChat(request, { fetch: fetcher }), code(expected));
  assert.equal(calls, 0);
});

test('credentials only come from explicit request or configured envKey; HTTP errors redact response and network errors', async () => {
  const previous = process.env.WORKBENCH_CHAT_TEST_KEY;
  process.env.WORKBENCH_CHAT_TEST_KEY = 'env-secret';
  try {
    await invokeChat(base, { fetch: fake(completion(), (_url, init) => assert.equal((init.headers as Record<string, string>).Authorization, undefined)) });
    await invokeChat({ ...base, connection: { ...base.connection, envKey: 'WORKBENCH_CHAT_TEST_KEY' } }, { fetch: fake(completion(), (_url, init) => assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer env-secret')) });
    await assert.rejects(invokeChat({ ...base, credential: 'private-secret' }, { fetch: (async () => new Response('private-secret source prompt', { status: 401 })) as typeof fetch }), error => {
      assert.ok(code('api-http-error')(error)); assert.doesNotMatch(String(error), /private-secret|source prompt/); return true;
    });
    await assert.rejects(invokeChat(base, { fetch: (async () => { throw new Error('private-secret'); }) as typeof fetch }), error => {
      assert.ok(code('api-network-error')(error)); assert.doesNotMatch(String(error), /private-secret/); return true;
    });
  } finally { if (previous === undefined) delete process.env.WORKBENCH_CHAT_TEST_KEY; else process.env.WORKBENCH_CHAT_TEST_KEY = previous; }
});

test('abort, timeout (including body reads), and response size limits bound the turn', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(invokeChat({ ...base, signal: controller.signal }, { fetch: fake(completion(), () => { calls++; }) }), code('cancelled'));
  assert.equal(calls, 0);
  const never = (async () => new Promise<Response>(() => {})) as typeof fetch;
  await assert.rejects(invokeChat({ ...base, profile: { ...base.profile, timeoutMs: 10 } }, { fetch: never }), code('timeout'));
  const live = new AbortController();
  const pending = invokeChat({ ...base, signal: live.signal }, { fetch: never }); live.abort();
  await assert.rejects(pending, code('cancelled'));
  let bodyCancelled = false;
  const stalledBody = new ReadableStream<Uint8Array>({ cancel() { bodyCancelled = true; } });
  await assert.rejects(invokeChat({ ...base, profile: { ...base.profile, timeoutMs: 10 } }, { fetch: (async () => new Response(stalledBody)) as typeof fetch }), code('timeout'));
  assert.equal(bodyCancelled, true);
  let oversizedCancelled = false;
  const oversized = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel() { oversizedCancelled = true; } });
  await assert.rejects(invokeChat(base, { fetch: (async () => new Response(oversized)) as typeof fetch }), code('output-limit'));
  assert.equal(oversizedCancelled, true);
});

test('capabilities state implemented API protocols and explicitly exclude CLI and System One', async () => {
  assert.equal(chatCapability(base.connection).supported, true); assert.equal(chatCapability(base.connection).streaming, true);
  assert.equal(chatCapability({ ...base.connection, apiMode: 'responses' }).protocol, 'responses');
  for (const kind of ['mock', 'codex', 'claude', 'grok', 'antigravity', 'systemone'] as const) {
    const connection = { ...base.connection, kind };
    assert.equal(chatCapability(connection).supported, false);
    await assert.rejects(invokeChat({ ...base, connection }, { fetch: fake(completion()) }), code('unsupported-chat-provider'));
  }
  for (const baseUrl of ['http://8.8.8.8/v1', 'https://secret@api.example.com/v1', 'https://api.example.com/v1?key=secret', 'ftp://localhost/v1']) assert.equal(chatCapability({ ...base.connection, baseUrl }).supported, false);
});
