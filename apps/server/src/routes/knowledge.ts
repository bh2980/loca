import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { mentions } from '../services/context.ts';
import { z } from 'zod';
import { DOCUMENT_KINDS, patchOf } from '@tw/shared';
import { found, validate, type Env } from '../context.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';

export const termInput = z.object({
  source: z.string().trim().min(1),
  target: z.string().default(''),
  note: z.string().default(''),
  /** candidate = proposed (not used as context yet), confirmed = used by AI nodes. */
  status: z.enum(['candidate', 'confirmed']).default('confirmed'),
});
export const documentInput = z.object({ kind: z.enum(DOCUMENT_KINDS).default('note'), title: z.string().trim().min(1), body: z.string().default(''), alwaysInclude: z.boolean().default(false) });
export const characterInput = z.object({ name: z.string().trim().min(1), aliases: z.array(z.string().trim().min(1)).default([]), profile: z.string().default('') });
export const relationshipInput = z.object({ fromId: z.string(), toId: z.string(), kind: z.string().trim().min(1), description: z.string().default(''), mutual: z.boolean().default(false) });

const byProject = <T extends typeof s.terms | typeof s.documents | typeof s.characters | typeof s.relationships>(table: T, id: string, projectId: string) =>
  and(eq(table.id, id), eq(table.projectId, projectId));

export const knowledgeRoutes = new Hono<Env>()
  .get('/terms', (c) => c.json(c.var.deps.db.select().from(s.terms).where(eq(s.terms.projectId, c.req.param('projectId')!)).orderBy(asc(s.terms.source)).all()))
  /** Lines whose source mentions the term (whole word, case-insensitive): what to re-run after changing it. */
  .get('/terms/:id/usage', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const term = found(db.select().from(s.terms).where(byProject(s.terms, c.req.param('id'), projectId)).get(), '용어');
    const pattern = `%${term.source.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    const rows = db
      .select({ id: s.units.id, key: s.units.key, groupId: s.units.groupId, groupTitle: s.groups.title, speaker: s.units.speaker, source: s.units.source, translation: s.units.translation })
      .from(s.units)
      .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
      .where(and(eq(s.units.projectId, projectId), sql`${s.units.source} like ${pattern} escape '\\'`))
      .orderBy(asc(s.groups.sort), asc(s.units.sort))
      .all()
      .filter((row) => mentions(row.source, term.source));
    return c.json({ count: rows.length, unitIds: rows.map((row) => row.id), rows: rows.slice(0, 100) });
  })
  .post('/terms', validate('json', termInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.terms).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'terms');
    return c.json(row, 201);
  })
  .patch('/terms/:id', validate('json', patchOf(termInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    found(c.var.deps.db.update(s.terms).set(c.req.valid('json')).where(byProject(s.terms, c.req.param('id'), projectId)).returning().get(), '용어');
    events.changed(projectId, 'terms');
    return c.json({ ok: true });
  })
  .delete('/terms/:id', (c) => {
    const projectId = c.req.param('projectId')!;
    c.var.deps.db.delete(s.terms).where(byProject(s.terms, c.req.param('id'), projectId)).run();
    events.changed(projectId, 'terms');
    return c.json({ ok: true });
  })

  .get('/documents', (c) => c.json(c.var.deps.db.select().from(s.documents).where(eq(s.documents.projectId, c.req.param('projectId')!)).orderBy(asc(s.documents.kind), asc(s.documents.title)).all()))
  .post('/documents', validate('json', documentInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.documents).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(row, 201);
  })
  .patch('/documents/:id', validate('json', patchOf(documentInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    found(c.var.deps.db.update(s.documents).set(c.req.valid('json')).where(byProject(s.documents, c.req.param('id'), projectId)).returning().get(), '문서');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  .delete('/documents/:id', (c) => {
    const projectId = c.req.param('projectId')!;
    c.var.deps.db.delete(s.documents).where(byProject(s.documents, c.req.param('id'), projectId)).run();
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })

  .get('/characters', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    return c.json({
      characters: db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).orderBy(asc(s.characters.name)).all(),
      relationships: db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all(),
    });
  })
  .post('/characters', validate('json', characterInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.characters).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(row, 201);
  })
  .patch('/characters/:id', validate('json', patchOf(characterInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    found(c.var.deps.db.update(s.characters).set(c.req.valid('json')).where(byProject(s.characters, c.req.param('id'), projectId)).returning().get(), '인물');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  .delete('/characters/:id', (c) => {
    const projectId = c.req.param('projectId')!;
    c.var.deps.db.delete(s.characters).where(byProject(s.characters, c.req.param('id'), projectId)).run();
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  .post('/relationships', validate('json', relationshipInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.relationships).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(row, 201);
  })
  .patch('/relationships/:id', validate('json', patchOf(relationshipInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    found(c.var.deps.db.update(s.relationships).set(c.req.valid('json')).where(byProject(s.relationships, c.req.param('id'), projectId)).returning().get(), '관계');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  .delete('/relationships/:id', (c) => {
    const projectId = c.req.param('projectId')!;
    c.var.deps.db.delete(s.relationships).where(byProject(s.relationships, c.req.param('id'), projectId)).run();
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  });
