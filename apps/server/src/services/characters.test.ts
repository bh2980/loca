import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { knowledgeRoutes } from '../routes/knowledge.ts';
import { agentTools } from './agent-tools.ts';
import { importProject } from './importer.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Hi.' }] });
  const { projectId } = importProject(db, file);
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/projects/:projectId', knowledgeRoutes);
  const send = (method: string, url: string, body: unknown) => app.request(`/projects/${projectId}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const terms = () => db.select({ source: s.terms.source, note: s.terms.note }).from(s.terms).where(eq(s.terms.projectId, projectId)).orderBy(s.terms.source).all();
  const characters = () => db.select({ name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
  const tool = (input: object) => agentTools(db, projectId).save_character.execute!(input as never, { toolCallId: 't', messages: [] } as never) as { ok: boolean; id?: string; error?: string };
  return { db, projectId, send, terms, characters, tool };
}

describe('saving a character (one service for the app and the chat)', () => {
  it('registers names that differ only in case as one term', async () => {
    const { send, terms, characters } = setup();
    const response = await send('POST', '/characters', { name: 'Mira', aliases: ['mira', 'Mi'] });
    expect(response.status).toBe(201);
    expect(characters()).toEqual([{ name: 'Mira', aliases: ['mira', 'Mi'] }]);
    expect(terms()).toEqual([{ source: 'Mi', note: 'Mira의 별칭' }, { source: 'Mira', note: '인물 이름' }]);
  });

  it('keeps a known term and gives an alias term without a note "X의 별칭"', async () => {
    const { db, projectId, send, terms } = setup();
    db.insert(s.terms).values([{ projectId, source: 'mira', note: '' }, { projectId, source: 'MIRA-chan', note: '애칭' }]).run();
    const { id } = (await (await send('POST', '/characters', { name: 'Ann' })).json()) as { id: string };
    expect((await send('PATCH', `/characters/${id}`, { aliases: ['Mira', 'mira-CHAN'] })).status).toBe(200);
    expect(terms()).toEqual([{ source: 'Ann', note: '인물 이름' }, { source: 'MIRA-chan', note: '애칭' }, { source: 'mira', note: 'Ann의 별칭' }]);
  });

  it('writes neither the character nor its terms when registering the names fails', async () => {
    const { db, send, terms, characters, tool } = setup();
    await send('POST', '/characters', { name: 'Kept' });
    db.run(sql`create trigger fail_terms before insert on terms begin select raise(abort, 'boom'); end`);
    expect((await send('POST', '/characters', { name: 'Mira', aliases: ['mira'] })).status).toBe(500);
    expect(() => tool({ name: 'Nova' })).toThrow('boom');
    expect(characters().map((row) => row.name)).toEqual(['Kept']);
    expect(terms().map((row) => row.source)).toEqual(['Kept']);
  });

  it('lets a person create a second character of the same name, while the chat is told to update the first', async () => {
    const { send, characters, tool } = setup();
    expect((await send('POST', '/characters', { name: 'Guard' })).status).toBe(201);
    expect((await send('POST', '/characters', { name: 'guard' })).status).toBe(201);
    expect(tool({ name: 'GUARD' })).toMatchObject({ ok: false, error: expect.stringContaining('같은 이름') });
    const created = tool({ name: 'Mira', aliases: ['mira'] });
    expect(created.ok).toBe(true);
    expect(tool({ id: created.id, name: 'Mira', aliases: ['mira', 'Miri'] })).toEqual({ ok: true, id: created.id });
    expect(tool({ id: 'nope', name: 'X' })).toMatchObject({ ok: false, error: '없는 인물입니다.' });
    expect(characters().map((row) => row.name)).toEqual(['Guard', 'guard', 'Mira']);
  });
});
