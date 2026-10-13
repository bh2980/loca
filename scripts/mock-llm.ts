/**
 * Deterministic OpenAI-compatible server for UI and workflow checks without a real model.
 *   pnpm mock-llm            → http://127.0.0.1:4398/v1   (model id: mock)
 * Workflows: translations are "[KO] <source>"; review fails a line once (lines ending in "?"), revise fixes it.
 * Chat: asks for tools the way a real model would (overview, then a character proposal when asked about 인물).
 * Every structured answer matches the server's zod schemas (checked by apps/server/src/engine/mock-llm.test.ts).
 *
 * Cost and failure profiles (environment variables; every one can also be sent per request as an
 * `x-mock-<name>` header, e.g. `x-mock-drop-rate: 0.1`, so one process serves several tests):
 *   MOCK_FIXED_TOKENS   added to prompt_tokens per request (agent CLIs add 13k-29k of their own)
 *   MOCK_CACHED_TOKENS  reported as prompt_tokens_details.cached_tokens (inside prompt_tokens)
 *   MOCK_LATENCY_MS     base latency + up to 25% jitter (default 400ms, 1500ms for work analysis)
 *   MOCK_DROP_RATE      fraction of per-line entries left out of the answer
 *   MOCK_DUP_RATE       fraction of entries that repeat the previous entry's id
 *   MOCK_EMPTY_RATE     fraction of translations with empty text
 *   MOCK_BAD_JSON_RATE  fraction of answers that are not valid JSON
 *   MOCK_429_RATE       fraction of requests answered 429 with a Retry-After header
 *   MOCK_TRUNCATE_RATE  fraction of answers cut short with finish_reason "length"
 *   MOCK_SEED           seed of the PRNG, so a run is reproducible (default 1)
 *   MOCK_PROFILE        presets, comma separated; explicit variables win
 *     cli-like  fixed 20000, cached 10000, latency 2000ms
 *     faulty    drop 0.05, 429 0.03, bad JSON 0.02, truncate 0.01
 * Usage is always token-like: prompt_tokens = fixed + ceil(chars/4), completion_tokens = ceil(chars/4).
 * GET /__stats → requests, by kind, input/cached/output tokens, lines-per-request histogram; POST /__reset clears it.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { detectKind, envGetter, hashString, headerGetter, makeRand, resolveOptions, respond, usageFor, type Usage } from './mock-llm-core.ts';

const port = Number(process.env.MOCK_LLM_PORT ?? 4398);
const app = new Hono();

const envOptions = resolveOptions(envGetter(process.env));
const random = makeRand(envOptions.seed);
/** Process settings, overridden by `x-mock-*` headers of one request. */
const requestOptions = (headers: Headers) => resolveOptions(headerGetter(headers), envOptions);

const stats = {
  requests: 0,
  rejected429: 0,
  byKind: {} as Record<string, number>,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  linesPerRequest: {} as Record<string, number>,
  record(kind: string, status: number, lines: number, usage: Usage) {
    this.requests++;
    this.byKind[kind] = (this.byKind[kind] ?? 0) + 1;
    if (status === 429) {
      this.rejected429++;
      return;
    }
    this.inputTokens += usage.prompt_tokens;
    this.cachedTokens += usage.prompt_tokens_details.cached_tokens;
    this.outputTokens += usage.completion_tokens;
    if (lines > 0) this.linesPerRequest[lines] = (this.linesPerRequest[lines] ?? 0) + 1;
  },
  reset() {
    this.requests = this.rejected429 = this.inputTokens = this.cachedTokens = this.outputTokens = 0;
    this.byKind = {};
    this.linesPerRequest = {};
  },
};
app.get('/__stats', (c) => c.json({ requests: stats.requests, rejected429: stats.rejected429, byKind: stats.byKind, inputTokens: stats.inputTokens, cachedTokens: stats.cachedTokens, outputTokens: stats.outputTokens, linesPerRequest: stats.linesPerRequest }));
app.post('/__reset', (c) => {
  stats.reset();
  return c.json({ ok: true });
});

interface Message {
  role: string;
  content?: string | { type: string; text?: string }[] | null;
  tool_calls?: unknown[];
}
const text = (message?: Message) => (typeof message?.content === 'string' ? message.content : (message?.content ?? []).map((part) => part.text ?? '').join(''));

/** A stand-in spell checker for the workflow HTTP function: drops the mock "[KO]" marks and tidies spaces. */
app.post('/spell', async (c) => {
  const { text } = (await c.req.json()) as { text?: string };
  const fixed = (text ?? '').replace(/\[KO✓?\]\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  return c.json({ result: { text: fixed, corrections: fixed === text ? 0 : 1 } });
});

app.get('/v1/models', (c) => c.json({ object: 'list', data: [{ id: 'mock', object: 'model' }] }));

app.post('/v1/chat/completions', async (c) => {
  const body = (await c.req.json()) as { messages: Message[]; stream?: boolean; tools?: { function: { name: string } }[]; response_format?: unknown };
  const system = body.messages.filter((message) => message.role === 'system').map(text).join('\n');
  const last = body.messages.at(-1);

  // Structured requests, and the editor's plain-text continuation.
  if (body.response_format || detectKind(system) === 'complete') {
    const options = requestOptions(c.req.raw.headers);
    const schema = (body.response_format as { json_schema?: { schema?: unknown } } | undefined)?.json_schema?.schema;
    const rand = c.req.header('x-mock-seed') ? makeRand(options.seed ^ hashString(system + text(last))) : random;
    const outcome = respond({ system, user: text(last), schema }, options, rand);
    stats.record(outcome.kind, outcome.status, outcome.lines, outcome.usage);
    await new Promise((resolve) => setTimeout(resolve, outcome.delayMs));
    if (outcome.status === 429) {
      c.header('Retry-After', String(outcome.retryAfterSeconds ?? 1));
      return c.json(JSON.parse(outcome.content), 429);
    }
    return c.json({
      id: 'mock',
      object: 'chat.completion',
      model: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: outcome.content }, finish_reason: outcome.finishReason }],
      usage: outcome.usage,
    });
  }

  // Chat agent turn.
  if (process.env.MOCK_DEBUG) console.log('roles', body.messages.map((message) => message.role).join(','));
  const tools = new Set(body.tools?.map((tool) => tool.function.name));
  const user = text([...body.messages].reverse().find((message) => message.role === 'user'));
  let call: { name: string; args: unknown } | undefined;
  if (last?.role !== 'tool') {
    const system = text(body.messages.find((message) => message.role === 'system'));
    const lineId = /- 대사: .*\[id=([\w-]+)\]/.exec(system)?.[1];
    const groupId = /- (?:장면|문서|UI): .*\[id=([\w-]+)\]/.exec(system)?.[1];
    const workflowId = /- 워크플로: .*\[id=([\w-]+)\]/.exec(system)?.[1];
    const nodeId = /- 워크플로 노드: .*\[id=([\w-]+)\]/.exec(system)?.[1];
    if (lineId && /제안|다듬/.test(user) && tools.has('propose_translation'))
      call = { name: 'propose_translation', args: { unitId: lineId, text: '[모의 제안] 문맥을 반영한 번역', note: '앞 대사의 말투를 이어감' } };
    else if (groupId && /요약/.test(user) && tools.has('save_group_summary'))
      call = { name: 'save_group_summary', args: { groupId, description: '[모의 요약] 미라와 조나스가 중계소에서 근무 일지를 확인하고 명령의 출처를 의심한다.' } };
    else if (workflowId && nodeId && /노드/.test(user) && tools.has('edit_workflow_node'))
      call = /조건/.test(user)
        ? { name: 'edit_workflow_node', args: { workflowId, nodeId, field: 'expression', value: { '<': [{ var: 'visits.review' }, 2] }, description: '검수 2회 미만' } }
        : /스크립트/.test(user)
          ? { name: 'edit_workflow_node', args: { workflowId, nodeId, field: 'code', value: 'export default function run(input) {\n  return { port: input.candidate ? "ok" : "fail" };\n}' } }
          : { name: 'edit_workflow_node', args: { workflowId, nodeId, field: 'instructions', value: '[모의 지시문] 원문의 말투와 장면 분위기를 유지해 자연스러운 한국어로 옮기세요.' } };
    else if (/인물|캐릭터/.test(user) && tools.has('save_character'))
      call = { name: 'save_character', args: { name: 'MIRA', aliases: ['Mira'], profile: '## 미라\n- 전직 통신병\n- 짧고 단정한 반말\n- 조나스와 오랜 동료' } };
    else if (tools.has('project_overview')) call = { name: 'project_overview', args: {} };
  }
  const table = '## 모의 현황\n\n| 항목 | 내용 |\n|---|---|\n| 프로젝트 | 모의 프로젝트 |\n| 대사 | 8,157개 |\n\n- [x] 표 렌더링\n- [ ] ~~취소선~~';
  const reply = /표/.test(user) ? table : last?.role === 'tool' ? '도구 결과를 확인했습니다. (모의 응답)' : `"${user.slice(0, 40)}"에 대한 모의 응답입니다.`;

  const options = requestOptions(c.req.raw.headers);
  const usage = usageFor(body.messages.map((message) => text(message)).join('').length + JSON.stringify(body.tools ?? []).length, (call ? JSON.stringify(call.args) : reply).length, options);
  stats.record('chat', 200, 0, usage);
  return streamSSE(c, async (stream) => {
    const chunk = (delta: unknown, finish: string | null = null) =>
      stream.writeSSE({ data: JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', model: 'mock', choices: [{ index: 0, delta, finish_reason: finish }] }) });
    if (call) {
      await chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: call.name, arguments: '' } }] });
      await chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(call.args) } }] });
      await chunk({}, 'tool_calls');
    } else {
      await chunk({ role: 'assistant', content: '' });
      for (const word of reply.split(' ')) {
        await chunk({ content: `${word} ` });
        await stream.sleep(30);
      }
      await chunk({}, 'stop');
    }
    await stream.writeSSE({ data: JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', model: 'mock', choices: [], usage }) });
    await stream.writeSSE({ data: '[DONE]' });
  });
});

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`mock LLM → http://127.0.0.1:${port}/v1 (model: mock)`));
