/**
 * Deterministic OpenAI-compatible server for UI and workflow checks without a real model.
 *   pnpm mock-llm            → http://127.0.0.1:4398/v1   (model id: mock)
 * Workflows: translations are "[KO] <source>"; review fails a line once (lines ending in "?"), revise fixes it.
 * Chat: asks for tools the way a real model would (overview, then a character proposal when asked about 인물).
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

const port = Number(process.env.MOCK_LLM_PORT ?? 4398);
const app = new Hono();

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

  if (body.response_format) {
    const input = JSON.parse(text(last)) as { lines: { id: string; source: string; candidate?: string }[] };
    // Lines mentioning "orders" never pass review, so they end up waiting for a person.
    const stubborn = (source: string) => /orders/i.test(source);
    if (system.includes('Find proper nouns')) {
      // Capitalised words that are not sentence starts stand in for proper nouns.
      const words = new Set(input.lines.flatMap((line) => [...line.source.matchAll(/(?<=\s)([A-Z][a-z]{3,})/g)].map((match) => match[1])));
      const terms = [...words].map((source) => ({ source, target: `[${source}]`, note: '모의 추출' }));
      return c.json({ id: 'mock', object: 'chat.completion', model: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ terms }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    const kind = system.includes('Review each') ? 'review' : system.includes('Revise each') ? 'revise' : 'translate';
    const content =
      kind === 'review'
        ? {
            results: input.lines.map((line) => {
              const failed = stubborn(line.source) || (line.source.trim().endsWith('?') && line.candidate?.startsWith('[KO]'));
              return { id: line.id, passed: !failed, issues: failed ? [stubborn(line.source) ? '“orders”의 대상(누구의 명령인지)이 번역에서 모호합니다.' : '의문문 어조가 자연스럽지 않습니다.'] : [] };
            }),
          }
        : { translations: input.lines.map((line) => ({ id: line.id, text: kind === 'revise' ? `[KO✓] ${line.source}` : `[KO] ${line.source}` })) };
    await new Promise((resolve) => setTimeout(resolve, 400));
    return c.json({
      id: 'mock',
      object: 'chat.completion',
      model: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: system.length + text(last).length, completion_tokens: JSON.stringify(content).length, total_tokens: 0 },
    });
  }

  // Chat agent turn.
  const tools = new Set(body.tools?.map((tool) => tool.function.name));
  const user = text([...body.messages].reverse().find((message) => message.role === 'user'));
  let call: { name: string; args: unknown } | undefined;
  if (last?.role !== 'tool') {
    if (/인물|캐릭터/.test(user) && tools.has('save_character'))
      call = { name: 'save_character', args: { name: 'MIRA', aliases: ['Mira'], profile: '## 미라\n- 전직 통신병\n- 짧고 단정한 반말\n- 조나스와 오랜 동료' } };
    else if (tools.has('project_overview')) call = { name: 'project_overview', args: {} };
  }
  const reply = last?.role === 'tool' ? '도구 결과를 확인했습니다. (모의 응답)' : `"${user.slice(0, 40)}"에 대한 모의 응답입니다.`;

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
    await stream.writeSSE({ data: JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', model: 'mock', choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) });
    await stream.writeSSE({ data: '[DONE]' });
  });
});

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`mock LLM → http://127.0.0.1:${port}/v1 (model: mock)`));
