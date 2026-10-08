import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { invokeProvider as invokeValidatedProvider, inspectConnection, ProviderError, type ProviderConnection, type ProviderRequest } from '../src/index.js';
import { parseCliOutput } from '../src/output.js';
import { cliArgs, resolveCli, invokeCli } from '../src/cli.js';
import { runProcess } from '../src/process.js';
import { invokeApi } from '../src/api.js';
// These are adapter wire tests. Catalog gating has separate end-to-end tests in models.test.ts.
const invokeProvider = (input: ProviderRequest) => input.connection.kind === 'openai' ? invokeApi(input) : invokeCli(input);

const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const request = (connection: ProviderConnection, overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  connection, profile: { connectionId: connection.id, model: 'user-chosen-model', effort: 'medium', timeoutMs: 4000, maxOutputTokens: 300, maxAttempts: 1 },
  prompt: 'Translate this dialogue as JSON.', schema, ...overrides,
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>, fn: (baseUrl: string) => Promise<void>) {
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await fn(`http://127.0.0.1:${address.port}/v1`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test('Chat adapter sends selected model/effort/schema and parses final answer and usage', async () => {
  await serve(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, 'user-chosen-model');
    assert.equal(body.reasoning_effort, 'medium');
    assert.equal(body.max_completion_tokens, 300);
    assert.deepEqual(body.response_format.json_schema.schema, schema);
    assert.equal(body.tools, undefined);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'server-reported-model', choices: [{ finish_reason: 'stop', message: { content: '{"text":"번역"}' } }], usage: { prompt_tokens: 15, completion_tokens: 9 } }));
  }, async (baseUrl) => {
    const result = await invokeProvider(request({ id: 'a', name: 'local test', kind: 'openai', baseUrl }));
    assert.deepEqual(result.data, { text: '번역' });
    assert.equal(result.usage?.inputTokens, 15);
    assert.equal(result.reportedModel, 'server-reported-model');
    assert.equal(result.reportedEffort, undefined); // Requested effort is not misreported as confirmed.
  });
});

test('Responses adapter reads assistant output_text, not reasoning or event metadata', async () => {
  await serve(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.url, '/v1/responses');
    assert.equal(body.reasoning.effort, 'medium');
    assert.deepEqual(body.text.format.schema, schema);
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'reasoning', summary: 'ignored' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"text":"응답"}' }] }], usage: { input_tokens: 3, output_tokens: 4 } }));
  }, async (baseUrl) => {
    const result = await invokeProvider(request({ id: 'a', name: 'test', kind: 'openai', baseUrl, apiMode: 'responses' }));
    assert.deepEqual(result.data, { text: '응답' });
  });
});

test('Refused, truncated and invalid structured responses cannot be applied', async () => {
  for (const [choice, code] of [
    [{ finish_reason: 'length', message: { content: '{"text":"partial"}' } }, 'incomplete-response'],
    [{ finish_reason: 'stop', message: { refusal: 'no', content: '{}' } }, 'refusal'],
    [{ finish_reason: 'stop', message: { content: '{"wrong":"value"}' } }, 'schema-mismatch'],
  ] as const) {
    await serve((_req, res) => { res.end(JSON.stringify({ choices: [choice] })); }, async (baseUrl) => {
      await assert.rejects(invokeProvider(request({ id: 'a', name: 'test', kind: 'openai', baseUrl })), (error) => error instanceof ProviderError && error.code === code);
    });
  }
});

test('HTTP errors never echo provider error bodies or secrets', async () => {
  await serve((_req, res) => { res.statusCode = 401; res.end('secret-credential-user-prompt'); }, async (baseUrl) => {
    await assert.rejects(invokeProvider(request({ id: 'a', name: 'test', kind: 'openai', baseUrl })), (error) => error instanceof ProviderError && !error.message.includes('secret-credential'));
  });
});

test('API timeout and cancellation are distinguishable and settle promptly', async () => {
  await serve(() => {}, async (baseUrl) => {
    const input = request({ id: 'a', name: 'test', kind: 'openai', baseUrl });
    input.profile.timeoutMs = 30;
    await assert.rejects(invokeProvider(input), (error) => error instanceof ProviderError && error.code === 'timeout');
    const controller = new AbortController();
    input.profile.timeoutMs = 4000;
    input.signal = controller.signal;
    const operation = invokeProvider(input);
    controller.abort();
    await assert.rejects(operation, (error) => error instanceof ProviderError && error.code === 'cancelled');
  });
});

test('Unsupported agy effort is rejected without invoking CLI', async () => {
  const input = request({ id: 'a', name: 'test', kind: 'antigravity', executable: 'does-not-exist' });
  input.profile.effort = 'ultra';
  await assert.rejects(invokeValidatedProvider(input), (error) => error instanceof ProviderError && error.code === 'unsupported-effort');
});

test('CLI result wrappers and final JSONL events parse, progress alone never passes', () => {
  assert.deepEqual(parseCliOutput('{"type":"result","is_error":false,"result":"{\\"text\\":\\"ok\\"}"}', schema).data, { text: 'ok' });
  assert.deepEqual(parseCliOutput('banner\n{"type":"system"}\n{"type":"result","structured_output":{"text":"ok"}}', schema).data, { text: 'ok' });
  assert.throws(() => parseCliOutput('{"type":"assistant","text":"looks like content"}', schema), /최종/);
  assert.throws(() => parseCliOutput('{"type":"result","is_error":true,"result":"{\\"text\\":\\"bad\\"}"}', schema), /실패/);
});

test('Grok Build 1.0.30 camelCase terminal envelope unwraps structuredOutput', () => {
  // Field shape observed in one tiny live probe; all fixture values are synthetic.
  const envelope = { text: '{"text":"text fallback"}', stopReason: 'stop', sessionId: 'fixture-session', requestId: 'fixture-request',
    usage: { input_tokens: 10, output_tokens: 3, reasoning_tokens: 0 }, num_turns: 1, total_cost_usd: 0,
    modelUsage: { 'fixture-model': { inputTokens: 10, outputTokens: 3, modelCalls: 1 } }, structuredOutput: { text: 'structured result' } };
  const result = parseCliOutput(JSON.stringify(envelope), schema);
  assert.deepEqual(result.data, { text: 'structured result' });
  assert.deepEqual(result.envelope?.usage, envelope.usage);
  assert.deepEqual(parseCliOutput('banner\n{"type":"assistant"}\n' + JSON.stringify(envelope), schema).data, result.data);
  const { structuredOutput, ...textOnly } = envelope;
  assert.deepEqual(parseCliOutput(JSON.stringify(textOnly), schema).data, { text: 'text fallback' });
  assert.throws(() => parseCliOutput(JSON.stringify({ ...envelope, structuredOutput: { wrong: 'must not use fallback' } }), schema), /스키마/);
  assert.throws(() => parseCliOutput(JSON.stringify({ ...envelope, stopReason: 'error' }), schema), /실패/);
  for (const stopReason of ['length', 'max_tokens', 'max_turns', 'truncated', 'context_limit']) {
    assert.throws(() => parseCliOutput(JSON.stringify({ ...envelope, stopReason }), schema), (error) => error instanceof ProviderError && error.code === 'incomplete-response');
  }
  assert.throws(() => parseCliOutput(JSON.stringify({ text: '{"text":"progress"}', structuredOutput }), schema), /스키마/);
  assert.throws(() => parseCliOutput(JSON.stringify({ ...envelope, type: 'assistant' }), schema), /최종/);
  assert.throws(() => parseCliOutput(JSON.stringify({ ...envelope, type: 'progress' }), schema), /최종/);
  assert.throws(() => parseCliOutput(JSON.stringify({ ...envelope, num_turns: 0 }), schema), /스키마/);
});

test('Grok fake CLI integration keeps tools disabled and parses real envelope shape', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'workbench-provider-test-'));
  const fixture = path.join(dir, 'fake-grok.mjs');
  await writeFile(fixture, `
const args=process.argv.slice(2);
if(args[args.indexOf('--tools')+1]!=='' || args[args.indexOf('--deny')+1]!=='*' || !args.includes('--no-subagents') || !args.includes('--disable-web-search'))process.exit(5);
const model=args[args.indexOf('--model')+1];
const modelUsage=model==='multi-model'?{'fixture-one':{modelCalls:1},'fixture-two':{modelCalls:1}}:{'provider-reported-model':{modelCalls:1}};
console.log(JSON.stringify({text:'{"text":"translated"}',stopReason:'stop',sessionId:'fixture-session',requestId:'fixture-request',structuredOutput:{text:'translated'},usage:{input_tokens:4,output_tokens:2},num_turns:1,modelUsage}));
`);
  try {
    const result = await invokeProvider(request({ id: 'grok-test', name: 'fixture', kind: 'grok', executable: fixture }));
    assert.deepEqual(result.data, { text: 'translated' });
    assert.equal(result.usage?.inputTokens, 4);
    assert.equal(result.usage?.outputTokens, 2);
    assert.equal(result.reportedModel, 'provider-reported-model');
    const multi = request({ id: 'grok-test', name: 'fixture', kind: 'grok', executable: fixture });
    multi.profile.model = 'multi-model';
    assert.equal((await invokeProvider(multi)).reportedModel, undefined);
  } finally {
    const canonical = await (await import('node:fs/promises')).realpath(dir);
    const parent = await (await import('node:fs/promises')).realpath(tmpdir());
    assert.equal(path.dirname(canonical), parent);
    assert.ok(path.basename(canonical).startsWith('workbench-provider-test-'));
    await rm(canonical, { recursive: true, force: true });
  }
});

test('CLI args do not include prompt content and keep process protections', () => {
  const input = request({ id: 'a', name: 'test', kind: 'codex' }, { prompt: '$(danger); `command` "quotes"' });
  const files = { dir: '/isolated', schema: '/isolated/schema.json', prompt: '/isolated/prompt.txt', result: '/isolated/result.json' };
  const codex = cliArgs(input, files);
  assert.ok(codex.includes('read-only'));
  assert.ok(codex.includes('--ignore-user-config'));
  assert.ok(codex.includes('features.hooks=false'));
  assert.ok(codex.includes('features.shell_tool=false'));
  assert.ok(codex.includes('features.multi_agent=false'));
  assert.ok(!codex.some((argument) => argument.includes('danger')));
  const grok = cliArgs({ ...input, connection: { ...input.connection, kind: 'grok' } }, files);
  assert.ok(grok.includes('--deny'));
  assert.ok(grok.includes('--no-subagents'));
  const agy = cliArgs({ ...input, connection: { ...input.connection, kind: 'antigravity' } }, files);
  assert.ok(agy.includes('--sandbox'));
  assert.ok(agy.includes('plan'));
});

test('Fake Codex process receives stdin, outputs schema-validated final file, temporary work is removed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'workbench-provider-test-'));
  const fixture = path.join(dir, 'fake-cli.mjs');
  await writeFile(fixture, `import fs from 'node:fs'; import readline from 'node:readline';
const args=process.argv.slice(2);
if(args.includes('app-server')) {
 for await(const line of readline.createInterface({input:process.stdin})) {
  const m=JSON.parse(line);
  if(m.method==='initialize') console.log(JSON.stringify({id:m.id,result:{}}));
  if(m.method==='config/read') console.log(JSON.stringify({id:m.id,result:{config:{cli_auth_credentials_store:'keyring',api_key:'DO-NOT-COPY'}}}));
 }
 process.exit(0);
}
let input=''; for await (const chunk of process.stdin) input+=chunk;
if (!args.includes('read-only') || !input.includes('특수 $(abc);') || !args.includes('cli_auth_credentials_store="keyring"') || args.some(a=>a.includes('DO-NOT-COPY'))) process.exit(5);
fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({text:process.cwd()}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:2,output_tokens:3}}));
`);
  try {
    const result = await invokeProvider(request({ id: 'a', name: 'fixture', kind: 'codex', executable: fixture }, { prompt: '특수 $(abc);' }));
    const outputDir = (result.data as { text: string }).text;
    assert.notEqual(outputDir, process.cwd());
    assert.equal(result.usage?.outputTokens, 3);
    const fs = await import('node:fs/promises');
    await assert.rejects(fs.access(outputDir));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Child timeout and cancellation terminate children; failure text is not leaked', async () => {
  await assert.rejects(runProcess({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: tmpdir(), timeoutMs: 100 }), (error) => error instanceof ProviderError && error.code === 'timeout');
  const controller = new AbortController();
  const pending = runProcess({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: tmpdir(), timeoutMs: 4000, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, (error) => error instanceof ProviderError && error.code === 'cancelled');
  await assert.rejects(runProcess({ executable: process.execPath, args: ['-e', 'console.error("secret");process.exit(3)'], cwd: tmpdir() }), (error) => error instanceof ProviderError && !error.message.includes('secret'));
});

test('Connection inspection checks config only and does not issue API requests', async () => {
  let calls = 0;
  await serve((_req, res) => { calls++; res.end('{}'); }, async (baseUrl) => {
    const result = await inspectConnection({ id: 'a', name: 'test', kind: 'openai', baseUrl });
    assert.equal(result.available, true);
    assert.equal(calls, 0);
    assert.match(result.detail, /확인되지/);
  });
});

test('Chat compatibility modes send only selected format and token-limit fields', async () => {
  for (const structuredOutput of ['json-schema', 'json-object', 'text'] as const) {
    await serve(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.max_tokens, 300);
      assert.equal(body.max_completion_tokens, undefined);
      if (structuredOutput === 'text') assert.equal(body.response_format, undefined);
      else assert.equal(body.response_format.type, structuredOutput === 'json-object' ? 'json_object' : 'json_schema');
      if (structuredOutput !== 'json-schema') assert.ok(body.messages[0].content.includes(JSON.stringify(schema)));
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"호환"}' } }] }));
    }, async (baseUrl) => {
      const result = await invokeProvider(request({ id: 'a', name: 'test', kind: 'openai', baseUrl, structuredOutput, tokenLimitField: 'max_tokens' }));
      assert.deepEqual(result.data, { text: '호환' });
    });
  }
});

test('Responses text compatibility omits format but keeps native token field', async () => {
  await serve(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.text, undefined);
    assert.equal(body.response_format, undefined);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.max_output_tokens, 300);
    assert.ok(body.instructions.includes(JSON.stringify(schema)));
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"text":"응답"}' }] }] }));
  }, async (baseUrl) => {
    await invokeProvider(request({ id: 'a', name: 'test', kind: 'openai', baseUrl, apiMode: 'responses', structuredOutput: 'text', tokenLimitField: 'max_tokens' }));
  });
});

test('Text compatibility still rejects output that violates the task schema', async () => {
  await serve((_req, res) => {
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"unrelated":true}' } }] }));
  }, async (baseUrl) => {
    await assert.rejects(invokeProvider(request({ id: 'a', name: 'test', kind: 'openai', baseUrl, structuredOutput: 'text' })),
      (error) => error instanceof ProviderError && error.code === 'schema-mismatch');
  });
});

test('Windows bare codex resolves npm shim safely without invoking a shell', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'workbench-provider-test-'));
  const entry = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const priorPath = process.env.PATH;
  try {
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, '// resolver fixture only');
    await writeFile(path.join(dir, 'codex.cmd'), '@echo This shim must never execute');
    process.env.PATH = dir;
    const resolved = await resolveCli({ id: 'c', name: 'codex', kind: 'codex', executable: 'codex' });
    assert.equal(resolved.executable, process.execPath);
    assert.deepEqual(resolved.prefixArgs, [entry]);
    await writeFile(path.join(dir, 'codex.exe'), 'native resolver fixture only');
    const native = await resolveCli({ id: 'c', name: 'codex', kind: 'codex', executable: 'codex' });
    assert.equal(native.executable, path.join(dir, 'codex.exe'));
    assert.deepEqual(native.prefixArgs, []);
  } finally {
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('Worker memory-only credential takes precedence over missing environment fallback', async () => {
  await serve((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fake-memory-only-test-key');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"비밀값 저장 없이 호출"}' } }] }));
  }, async (baseUrl) => {
    const result = await invokeProvider(request({ id: 'a', name: 'test', kind: 'openai', baseUrl, envKey: 'WORKBENCH_NONEXISTENT_TEST_KEY' }, { credential: 'fake-memory-only-test-key' }));
    assert.ok(!JSON.stringify(result).includes('fake-memory-only-test-key'));
    assert.equal(result.data && (result.data as { text: string }).text, '비밀값 저장 없이 호출');
  });
});
