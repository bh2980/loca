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

  if (body.response_format && system.includes('complete script of a game')) {
    // Work analysis: speakers become characters; each speaker → the next different speaker gets a rule.
    const lines = [...text(last).matchAll(/^\s*(L\d+) ([^:\[]+?): /gm)].map((match) => ({ id: match[1], speaker: match[2].trim() })).filter((line) => line.speaker !== '-');
    const counts = Map.groupBy(lines, (line) => line.speaker);
    const cast = [...counts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
    const pairs = new Map<string, { from: string; to: string; evidence: string[] }>();
    lines.forEach((line, index) => {
      const next = lines.slice(index + 1).find((other) => other.speaker !== line.speaker);
      if (!next || !cast.some(([name]) => name === line.speaker) || !cast.some(([name]) => name === next.speaker)) return;
      const key = `${line.speaker}|${next.speaker}`;
      const pair = pairs.get(key) ?? { from: line.speaker, to: next.speaker, evidence: [] };
      if (pair.evidence.length < 3) pair.evidence.push(line.id);
      pairs.set(key, pair);
    });
    const levels = ['hae', 'haeyo', 'hasipsio', 'haera'] as const;
    const content = {
      overview: { setting: '모의 분석: 대본에 나온 장소', mainConflict: '모의 갈등', plot: `모의 줄거리 (대사 ${lines.length}줄을 읽음)`, evidence: lines.slice(0, 3).map((line) => line.id) },
      characters: cast.map(([name, rows], index) => ({ name, aliases: [], profile: `대사 ${rows.length}줄`, speech: '모의 말투 설명', player: index === cast.length - 1, evidence: rows.slice(0, 3).map((row) => row.id) })),
      relationships: [...pairs.values()].slice(0, 6).map((pair) => ({ from: pair.from, to: pair.to, kind: '아는 사이', description: '모의 관계', changes: [], evidence: pair.evidence })),
      events: [{ title: '모의 사건', summary: '처음 장면의 일', cause: '', outcome: '', participants: cast.slice(0, 2).map(([name]) => name), evidence: lines.slice(0, 2).map((line) => line.id) }],
      speechRules: [...pairs.values()].map((pair, index) => ({ from: pair.from, to: pair.to, level: levels[index % 4], address: '', note: '모의 규칙', start: null, evidence: pair.evidence })),
    };
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return c.json({ id: 'mock', object: 'chat.completion', model: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: Math.ceil(text(last).length / 4), completion_tokens: 500, total_tokens: 0 } });
  }

  if (body.response_format) {
    const input = JSON.parse(text(last)) as { lines: { id: string; source: string; candidate?: string }[] };
    // Lines mentioning "orders" never pass review, so they end up waiting for a person.
    const stubborn = (source: string) => /orders/i.test(source);
    if (system.includes('Report only what the scene adds')) {
      // One event per scene, named after its first line; nothing else is new.
      const first = input.lines[0];
      const content = { characters: [], relationships: [], speechRules: [], events: first ? [{ title: `모의 사건: ${first.source.slice(0, 30)}`, summary: '모의 요약', outcome: '', participants: [], evidence: [first.id] }] : [] };
      return c.json({ id: 'mock', object: 'chat.completion', model: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    if (system.includes('who the speaker is addressing')) {
      // The listener is the next different speaker in the batch (else the previous one); the first line of a batch is unsure.
      const rows = input.lines as { id: string; source: string; speaker?: string }[];
      const listeners = rows.map((line, index) => {
        const other = rows.slice(index + 1).find((row) => row.speaker && row.speaker !== line.speaker) ?? rows.slice(0, index).reverse().find((row) => row.speaker && row.speaker !== line.speaker);
        return { id: line.id, listener: other?.speaker ?? null, confidence: index === 0 ? 0.6 : other ? 0.95 : 0.3 };
      });
      return c.json({ id: 'mock', object: 'chat.completion', model: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ listeners }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
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
