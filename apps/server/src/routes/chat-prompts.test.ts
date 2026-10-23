import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { importFileSchema, savedPromptsSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import { importProject } from '../services/importer.ts';
import { chatRoutes, describeView } from './chat.ts';
import { projectRoutes } from './projects.ts';

const setup = () => {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'P' },
    groups: [{ key: 'scene-a', title: '폐허의 만남' }],
    units: [
      { key: 'u1', group: 'scene-a', source: 'The lighthouse is dark tonight.', speaker: 'Mira' },
      { key: 'u2', group: 'scene-a', source: 'Hello', speaker: 'Jonas' },
    ],
  });
  const { projectId } = importProject(db, file, null as never);
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/projects', projectRoutes)
    .route('/', chatRoutes);
  const send = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { projectId, send };
};

describe('saved prompts (저장한 지시)', () => {
  it('schema: names have no spaces or slash and are unique (the app has no commands of its own to clash with)', () => {
    expect(savedPromptsSchema.safeParse([{ name: '요약', text: '이 장면을 요약해줘' }]).success).toBe(true);
    expect(savedPromptsSchema.safeParse([{ name: 'a b', text: 'x' }]).success).toBe(false);
    expect(savedPromptsSchema.safeParse([{ name: '/a', text: 'x' }]).success).toBe(false);
    expect(savedPromptsSchema.safeParse([{ name: 'model', text: 'x' }, { name: 'new', text: '{대상}을 봐 줘' }]).success).toBe(true);
    expect(savedPromptsSchema.safeParse([{ name: 'A', text: 'x' }, { name: 'a', text: 'y' }]).success).toBe(false);
    expect(savedPromptsSchema.safeParse([{ name: 'a', text: '  ' }]).success).toBe(false);
  });

  it('is empty at first, saved whole, and kept when the other agent settings are saved', async () => {
    const { projectId, send } = setup();
    expect(await (await send('GET', `/projects/${projectId}/prompts`)).json()).toEqual([]);
    const prompts = [{ name: '요약', text: '이 장면을 요약해줘' }, { name: 'tone', text: '말투를 점검해줘' }];
    expect((await send('PUT', `/projects/${projectId}/prompts`, { prompts })).status).toBe(200);
    expect(await (await send('GET', `/projects/${projectId}/prompts`)).json()).toEqual(prompts);
    expect((await send('PUT', `/projects/${projectId}/prompts`, { prompts: [{ name: 'a b', text: 'x' }] })).status).toBe(400);
    expect(await (await send('GET', `/projects/${projectId}/prompts`)).json()).toEqual(prompts);
    expect((await send('GET', '/projects/missing/prompts')).status).toBe(404);
  });
});

describe('describing @-attached items to the model', () => {
  it('lists them apart from what the page reports', () => {
    const text = describeView({ page: '번역', path: '/p/1', items: [{ kind: '대사', id: 'a', label: 'on screen' }, { kind: '용어', id: 'b', label: 'x → y', detail: '메모', attached: true }] });
    expect(text).toContain('- 대사: on screen [id=a]');
    expect(text.indexOf('직접 첨부한 항목')).toBeGreaterThan(text.indexOf('on screen'));
    expect(text).toContain('- 용어: x → y [id=b]\n  메모');
  });
  it('tells the model each attached item\'s kind, id and label, and the tool that reads it', () => {
    const text = describeView({
      page: '번역',
      path: '/p/1',
      items: [
        { kind: '대사', id: 'u1', label: 'REEVE: Excuse me…', detail: 'c1.ferry.002', attached: true },
        { kind: '장면', id: 'g1', label: 'Greywater Ferry', attached: true },
        { kind: '인물', id: 'p1', label: 'Lookout', attached: true },
        { kind: '태그', id: 't1', label: '#청자 미상', attached: true },
        { kind: '실행 기록', id: 'r1', label: '10/23 11:02 · 번역', attached: true },
      ],
    });
    expect(text).toContain('- 대사: REEVE: Excuse me… [id=u1]\n  c1.ferry.002\n  → read_line(unitId)');
    expect(text).toContain('- 장면: Greywater Ferry [id=g1]\n  → read_scene(sceneId)');
    expect(text).toContain('- 인물: Lookout [id=p1]\n  → list_characters, find_lines(speakers');
    expect(text).toContain('find_lines(tags: [id])');
    expect(text).toContain('read_run(runId)');
  });
});
