import { Hono } from 'hono';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { mentions } from '../services/context.ts';
import { z } from 'zod';
import { DOCUMENT_KINDS, KNOWLEDGE_STATUSES, modelChoiceSchema, patchOf, relationshipChangeSchema, SPEECH_LEVELS } from '@tw/shared';
import { badRequest, found, validate, type Env } from '../context.ts';
import { eachChunk, inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { graphOrder, ruleLines } from '../services/speech.ts';
import { eventFlow, forks } from '../services/event-routes.ts';
import { discoverAndSave, SUGGEST_BATCH } from '../services/terms.ts';

export const termInput = z.object({
  source: z.string().trim().min(1),
  target: z.string().default(''),
  note: z.string().default(''),
  /** candidate = proposed (not used as context yet), confirmed = used by AI nodes. */
  status: z.enum(['candidate', 'confirmed']).default('confirmed'),
});
/** Editing a draft keeps it a candidate; confirming is a separate, explicit step. */
const status = z.enum(KNOWLEDGE_STATUSES).default('confirmed');
const evidence = z.array(z.string().min(1)).default([]);
export const documentInput = z.object({ kind: z.enum(DOCUMENT_KINDS).default('note'), title: z.string().trim().min(1), body: z.string().default(''), alwaysInclude: z.boolean().default(false), status });
export const characterInput = z.object({ name: z.string().trim().min(1), aliases: z.array(z.string().trim().min(1)).default([]), profile: z.string().default(''), speech: z.string().default(''), player: z.boolean().default(false), status });
export const relationshipInput = z.object({ fromId: z.string(), toId: z.string(), kind: z.string().trim().min(1), description: z.string().default(''), mutual: z.boolean().default(false), changes: z.array(relationshipChangeSchema).default([]), status });
export const eventInput = z.object({ title: z.string().trim().min(1), summary: z.string().default(''), cause: z.string().default(''), outcome: z.string().default(''), participants: z.array(z.string().trim().min(1)).default([]), evidence, status });
export const speechRuleInput = z.object({
  fromName: z.string().trim().min(1),
  toName: z.string().trim().min(1),
  level: z.enum(SPEECH_LEVELS),
  address: z.string().default(''),
  note: z.string().default(''),
  startKey: z.string().trim().min(1).nullable().default(null),
  evidence,
  status,
});

/** Tables whose rows a person confirms or discards as drafts. */
const DRAFT_TABLES = { documents: s.documents, characters: s.characters, relationships: s.relationships, events: s.storyEvents, speechRules: s.speechRules, terms: s.terms } as const;
export const draftKinds = Object.keys(DRAFT_TABLES) as (keyof typeof DRAFT_TABLES)[];

type ProjectTable = typeof s.terms | (typeof DRAFT_TABLES)[keyof typeof DRAFT_TABLES];
const byProject = <T extends ProjectTable>(table: T, id: string, projectId: string) => and(eq(table.id, id), eq(table.projectId, projectId));

export const knowledgeRoutes = new Hono<Env>()
  // Rejected terms stay stored so "대본에서 찾기" does not propose them again, but are not listed.
  .get('/terms', (c) => c.json(c.var.deps.db.select().from(s.terms).where(and(eq(s.terms.projectId, c.req.param('projectId')!), ne(s.terms.status, 'rejected'))).orderBy(asc(s.terms.source)).all()))
  .post('/terms/discover', (c) => c.json(discoverAndSave(c.var.deps.db, c.req.param('projectId')!)))
  .get('/terms/suggest', (c) => {
    const projectId = c.req.param('projectId')!;
    const pending = c.var.deps.terms.pending(projectId).length;
    return c.json({ state: c.var.deps.terms.state(projectId), pending, calls: Math.ceil(pending / SUGGEST_BATCH), batch: SUGGEST_BATCH });
  })
  .post('/terms/suggest', validate('json', modelChoiceSchema), (c) => {
    try {
      return c.json(c.var.deps.terms.start(c.req.param('projectId')!, c.req.valid('json')));
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }
  })
  .post('/terms/suggest/cancel', (c) => {
    c.var.deps.terms.cancel(c.req.param('projectId')!);
    return c.json({ ok: true });
  })
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
      .orderBy(asc(s.units.seq))
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
    found(c.var.deps.db.update(s.terms).set({ ...c.req.valid('json'), reviewed: true }).where(byProject(s.terms, c.req.param('id'), projectId)).returning().get(), '용어');
    events.changed(projectId, 'terms');
    return c.json({ ok: true });
  })
  .delete('/terms/:id', (c) => {
    const projectId = c.req.param('projectId')!;
    c.var.deps.db.delete(s.terms).where(byProject(s.terms, c.req.param('id'), projectId)).run();
    events.changed(projectId, 'terms');
    return c.json({ ok: true });
  })

  .get('/documents', (c) => c.json(c.var.deps.db.select().from(s.documents).where(and(eq(s.documents.projectId, c.req.param('projectId')!), ne(s.documents.status, 'rejected'))).orderBy(asc(s.documents.kind), asc(s.documents.title)).all()))
  .post('/documents', validate('json', documentInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.documents).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(row, 201);
  })
  .patch('/documents/:id', validate('json', patchOf(documentInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    found(c.var.deps.db.update(s.documents).set({ ...c.req.valid('json'), reviewed: true }).where(byProject(s.documents, c.req.param('id'), projectId)).returning().get(), '문서');
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
      characters: db.select().from(s.characters).where(and(eq(s.characters.projectId, projectId), ne(s.characters.status, 'rejected'))).orderBy(asc(s.characters.name)).all(),
      relationships: db.select().from(s.relationships).where(and(eq(s.relationships.projectId, projectId), ne(s.relationships.status, 'rejected'))).all(),
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
    found(c.var.deps.db.update(s.characters).set({ ...c.req.valid('json'), reviewed: true }).where(byProject(s.characters, c.req.param('id'), projectId)).returning().get(), '인물');
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
    found(c.var.deps.db.update(s.relationships).set({ ...c.req.valid('json'), reviewed: true }).where(byProject(s.relationships, c.req.param('id'), projectId)).returning().get(), '관계');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  .delete('/relationships/:id', (c) => {
    const projectId = c.req.param('projectId')!;
    c.var.deps.db.delete(s.relationships).where(byProject(s.relationships, c.req.param('id'), projectId)).run();
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  /** Events with where they happen (the earliest of their evidence lines: script position, section, scene) and which events they lead to, for the flow graph. */
  .get('/events', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const events = db.select().from(s.storyEvents).where(and(eq(s.storyEvents.projectId, projectId), ne(s.storyEvents.status, 'rejected'))).all();
    const keys = [...new Set(events.flatMap((event) => event.evidence))];
    const lines = new Map(
      inChunks(keys, (slice) =>
        db.select({ key: s.units.key, seq: s.units.seq, kind: s.units.kind, section: s.groups.section, scene: s.groups.title }).from(s.units).innerJoin(s.groups, eq(s.groups.id, s.units.groupId)).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, slice))).all(),
      ).map((line) => [line.key, line]),
    );
    const placed = events.map((event) => {
      // Where the event happens: its earliest spoken evidence line; UI and document text (menus, event
      // banners) only when it has no dialogue evidence, since such text often sits far from the scene.
      const cited = event.evidence.flatMap((key) => lines.get(key) ?? []);
      const spoken = cited.filter((line) => line.kind === 'dialogue');
      const first = (spoken.length ? spoken : cited).sort((a, b) => a.seq - b.seq)[0];
      return { ...event, at: first ? { seq: first.seq, section: first.section, scene: first.scene, key: first.key } : null };
    });
    const graphNodes = db.select({ id: s.graphNodes.id, kind: s.graphNodes.kind, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
    const graphEdges = db.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId, label: s.graphEdges.label }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
    const keyOf = new Map(db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.id, unit.key]));
    return c.json(eventFlow(graphOrder(db, projectId), forks(graphNodes, graphEdges, keyOf), placed));
  })
  .post('/events', validate('json', eventInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.storyEvents).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(row, 201);
  })
  .patch('/events/:id', validate('json', patchOf(eventInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    found(c.var.deps.db.update(s.storyEvents).set({ ...c.req.valid('json'), reviewed: true }).where(byProject(s.storyEvents, c.req.param('id'), projectId)).returning().get(), '사건');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  .delete('/events/:id', (c) => {
    const projectId = c.req.param('projectId')!;
    c.var.deps.db.delete(s.storyEvents).where(byProject(s.storyEvents, c.req.param('id'), projectId)).run();
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })

  .get('/speech-rules', (c) => c.json(c.var.deps.db.select().from(s.speechRules).where(and(eq(s.speechRules.projectId, c.req.param('projectId')!), ne(s.speechRules.status, 'rejected'))).all()))
  .post('/speech-rules', validate('json', speechRuleInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.speechRules).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(row, 201);
  })
  .patch('/speech-rules/:id', validate('json', patchOf(speechRuleInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    found(c.var.deps.db.update(s.speechRules).set({ ...c.req.valid('json'), reviewed: true, review: null }).where(byProject(s.speechRules, c.req.param('id'), projectId)).returning().get(), '말투 규칙');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  .delete('/speech-rules/:id', (c) => {
    const projectId = c.req.param('projectId')!;
    c.var.deps.db.delete(s.speechRules).where(byProject(s.speechRules, c.req.param('id'), projectId)).run();
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true });
  })
  /** Make several AI items official (confirmed and reviewed) or discard them; official knowledge is never touched here. */
  /** The lines a speech rule governs (its pair, its stretch), with the speech levels their translations end in. */
  .get('/speech-rules/:id/lines', (c) => c.json(found(ruleLines(c.var.deps.db, c.req.param('projectId')!, c.req.param('id')) ?? undefined, '말투 규칙')))
  /** Work analysis jobs, newest first. */
  .get('/analysis', (c) => c.json(c.var.deps.analysis.list(c.req.param('projectId')!)))
  .post('/analysis', validate('json', z.object({ model: modelChoiceSchema, autoConfirm: z.boolean().default(true), resume: z.boolean().default(false) })), (c) => {
    try {
      return c.json(c.var.deps.analysis.start(c.req.param('projectId')!, c.req.valid('json').model, c.req.valid('json').autoConfirm, c.req.valid('json').resume), 201);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }
  })
  .post('/analysis/:jobId/cancel', (c) => {
    c.var.deps.analysis.cancel(c.req.param('jobId'));
    return c.json({ ok: true });
  })
  .post(
    '/drafts',
    validate('json', z.object({ kind: z.enum(draftKinds as [keyof typeof DRAFT_TABLES, ...(keyof typeof DRAFT_TABLES)[]]), ids: z.array(z.string()).min(1), action: z.enum(['confirm', 'discard']) })),
    (c) => {
      const projectId = c.req.param('projectId')!;
      const { kind, ids, action } = c.req.valid('json');
      const table = DRAFT_TABLES[kind];
      // Anything not yet official: AI candidates and AI items confirmed automatically.
      const where = (slice: string[]) => and(eq(table.projectId, projectId), inArray(table.id, slice), or(eq(table.status, 'candidate'), and(eq(table.origin, 'ai'), eq(table.reviewed, false))));
      const { db } = c.var.deps;
      // Chunked inside the one transaction: a bulk action can cover thousands of drafts.
      const changed = db.transaction((tx) => {
        let total = 0;
        eachChunk(ids, (slice) => {
          if (action === 'discard') {
            // Kept as rejected: a later analysis must not propose the same item again.
            total += tx.update(table).set({ status: 'rejected', reviewed: true, ...(kind === 'speechRules' ? { review: null } : {}) }).where(where(slice)).run().changes;
            return;
          }
          // A confirmed relationship needs confirmed people at both ends.
          if (kind === 'relationships') {
            const ends = tx.select({ fromId: s.relationships.fromId, toId: s.relationships.toId }).from(s.relationships).where(where(slice)).all().flatMap((r) => [r.fromId, r.toId]);
            eachChunk(ends, (people) => {
              tx.update(s.characters).set({ status: 'confirmed' }).where(and(eq(s.characters.projectId, projectId), inArray(s.characters.id, people))).run();
            });
          }
          total += tx.update(table).set({ status: 'confirmed', reviewed: true, ...(kind === 'speechRules' ? { review: null } : {}) }).where(where(slice)).run().changes;
        }, 2_000);
        return total;
      });
      events.changed(projectId, 'knowledge');
      return c.json({ changed });
    },
  );

