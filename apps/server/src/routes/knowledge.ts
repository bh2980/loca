import { Hono } from 'hono';
import { and, asc, eq, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { KNOWLEDGE_TAG_KINDS, modelChoiceSchema, patchOf } from '@tw/shared';
import { badRequest, found, notFound, validate, type Env } from '../context.ts';
import { eachChunk, inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { deleteItems } from '../services/item-delete.ts';
import { events } from '../events.ts';
import { graphOrder, ruleLines } from '../services/speech.ts';
import { eventFlow, forks } from '../services/event-routes.ts';
import { fillTermUsage, termUsage } from '../services/term-usage.ts';
import { saveCharacter } from '../services/characters.ts';
import { discoverAndSave, saveTerm, SUGGEST_BATCH } from '../services/terms.ts';
import { byPerson } from '../services/status-by.ts';
import { clearReview, setKnowledgeTag, withTags } from '../services/knowledge-tags.ts';
import { listAnalyses } from '../services/analysis-runs.ts';
import { characterInput, documentInput, eventInput, relationshipInput, speechRuleInput, termInput } from '../schemas/knowledge.ts';

/** Tables whose rows a person confirms or discards as drafts. */
const DRAFT_TABLES = { documents: s.documents, characters: s.characters, relationships: s.relationships, events: s.storyEvents, speechRules: s.speechRules, terms: s.terms } as const;
export const draftKinds = Object.keys(DRAFT_TABLES) as (keyof typeof DRAFT_TABLES)[];

type ProjectTable = typeof s.terms | (typeof DRAFT_TABLES)[keyof typeof DRAFT_TABLES];
/** A project's rows a person sees: rejected ones stay stored (so an analysis does not propose them again) but are not listed. */
const visible = <T extends ProjectTable>(table: T, projectId: string) => and(eq(table.projectId, projectId), ne(table.status, 'rejected'));
const byProject = <T extends ProjectTable>(table: T, id: string, projectId: string) => and(eq(table.id, id), eq(table.projectId, projectId));

export const knowledgeRoutes = new Hono<Env>()
  .get('/terms', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    fillTermUsage(db, projectId);
    return c.json(withTags(db, 'terms', db.select().from(s.terms).where(visible(s.terms, projectId)).orderBy(asc(s.terms.source)).all()));
  })
  .get('/terms/suggest', (c) => {
    const projectId = c.req.param('projectId')!;
    const pending = c.var.deps.terms.pending(projectId).length;
    return c.json({ state: c.var.deps.terms.state(projectId), pending, calls: Math.ceil(pending / SUGGEST_BATCH), batch: SUGGEST_BATCH });
  })
  .post('/terms/suggest', validate('json', modelChoiceSchema), (c) => {
    try {
      return c.json(c.var.deps.terms.start(c.req.param('projectId')!, c.req.valid('json')));
    } catch (error) {
      badRequest(error instanceof Error ? error.message : String(error));
    }
  })
  .post('/terms/suggest/cancel', (c) => {
    c.var.deps.terms.cancel(c.req.param('projectId')!);
    return c.json({ ok: true });
  })
  .post('/terms/discover', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const result = discoverAndSave(db, projectId);
    return c.json(result);
  })
  /** Lines whose source or speaker mentions the term (whole word, case-insensitive): what to re-run after changing it. */
  .get('/terms/:id/usage', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const term = found(db.select().from(s.terms).where(byProject(s.terms, c.req.param('id'), projectId)).get(), '용어');
    const rows = termUsage(db, projectId, term);
    return c.json({ count: rows.length, unitIds: rows.map((row) => row.id), rows: rows.slice(0, 100) });
  })
  .post('/terms', validate('json', termInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const saved = c.var.deps.db.transaction((tx) => saveTerm(tx, projectId, c.req.valid('json'), { by: 'person' }));
    if (!saved.ok) badRequest(saved.error);
    events.changed(projectId, 'terms');
    return c.json(saved.row, 201);
  })
  .patch('/terms/:id', validate('json', patchOf(termInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    const saved = c.var.deps.db.transaction((tx) => saveTerm(tx, projectId, c.req.valid('json'), { id: c.req.param('id'), by: 'person' }));
    if (!saved.ok) {
      if (saved.reason === 'missing') notFound('용어');
      badRequest(saved.error);
    }
    events.changed(projectId, 'terms');
    return c.json({ ok: true });
  })
  .delete('/terms/:id', (c) => {
    deleteItems(c.var.deps.db, c.req.param('projectId')!, 'terms', [c.req.param('id')]);
    return c.json({ ok: true });
  })

  .get('/documents', (c) => c.json(withTags(c.var.deps.db, 'documents', c.var.deps.db.select().from(s.documents).where(visible(s.documents, c.req.param('projectId')!)).orderBy(asc(s.documents.kind), asc(s.documents.title)).all())))
  .get('/documents/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const row = found(db.select().from(s.documents).where(byProject(s.documents, c.req.param('id'), projectId)).get(), '문서');
    return c.json(withTags(db, 'documents', [row])[0]);
  })
  .post('/documents', validate('json', documentInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.documents).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(withTags(c.var.deps.db, 'documents', [row])[0], 201);
  })
  .patch('/documents/:id', validate('json', patchOf(documentInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = found(c.var.deps.db.update(s.documents).set({ ...c.req.valid('json'), ...byPerson(c.var.deps.db, s.documents, projectId, c.req.param('id'), c.req.valid('json')) }).where(byProject(s.documents, c.req.param('id'), projectId)).returning().get(), '문서');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true as const, ...withTags(c.var.deps.db, 'documents', [row])[0] });
  })
  .delete('/documents/:id', (c) => {
    deleteItems(c.var.deps.db, c.req.param('projectId')!, 'documents', [c.req.param('id')]);
    return c.json({ ok: true });
  })

  .get('/characters', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    return c.json({
      characters: withTags(db, 'characters', db.select().from(s.characters).where(visible(s.characters, projectId)).orderBy(asc(s.characters.name)).all()),
      relationships: withTags(db, 'relationships', db.select().from(s.relationships).where(visible(s.relationships, projectId)).all()),
    });
  })
  .get('/characters/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const row = found(db.select().from(s.characters).where(byProject(s.characters, c.req.param('id'), projectId)).get(), '인물');
    return c.json(withTags(db, 'characters', [row])[0]);
  })
  .post('/characters', validate('json', characterInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = saveCharacter(c.var.deps.db, projectId, c.req.valid('json'));
    return c.json(withTags(c.var.deps.db, 'characters', [row])[0], 201);
  })
  .patch('/characters/:id', validate('json', patchOf(characterInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = found(saveCharacter(c.var.deps.db, projectId, c.req.valid('json'), c.req.param('id')), '인물');
    return c.json({ ok: true as const, ...withTags(c.var.deps.db, 'characters', [row])[0] });
  })
  .delete('/characters/:id', (c) => {
    deleteItems(c.var.deps.db, c.req.param('projectId')!, 'characters', [c.req.param('id')]);
    return c.json({ ok: true });
  })
  .get('/relationships/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const row = found(db.select().from(s.relationships).where(byProject(s.relationships, c.req.param('id'), projectId)).get(), '관계');
    return c.json(withTags(db, 'relationships', [row])[0]);
  })
  .post('/relationships', validate('json', relationshipInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.relationships).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(withTags(c.var.deps.db, 'relationships', [row])[0], 201);
  })
  .patch('/relationships/:id', validate('json', patchOf(relationshipInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = found(c.var.deps.db.update(s.relationships).set({ ...c.req.valid('json'), ...byPerson(c.var.deps.db, s.relationships, projectId, c.req.param('id'), c.req.valid('json')) }).where(byProject(s.relationships, c.req.param('id'), projectId)).returning().get(), '관계');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true as const, ...withTags(c.var.deps.db, 'relationships', [row])[0] });
  })
  .delete('/relationships/:id', (c) => {
    deleteItems(c.var.deps.db, c.req.param('projectId')!, 'relationships', [c.req.param('id')]);
    return c.json({ ok: true });
  })
  /** Events with where they happen (the earliest of their evidence lines: script position, section, scene) and which events they lead to, for the flow graph. */
  .get('/events', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const events = withTags(db, 'events', db.select().from(s.storyEvents).where(visible(s.storyEvents, projectId)).all());
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
  .get('/events/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const row = found(db.select().from(s.storyEvents).where(byProject(s.storyEvents, c.req.param('id'), projectId)).get(), '사건');
    return c.json(withTags(db, 'events', [row])[0]);
  })
  .post('/events', validate('json', eventInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.storyEvents).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(withTags(c.var.deps.db, 'events', [row])[0], 201);
  })
  .patch('/events/:id', validate('json', patchOf(eventInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = found(c.var.deps.db.update(s.storyEvents).set({ ...c.req.valid('json'), ...byPerson(c.var.deps.db, s.storyEvents, projectId, c.req.param('id'), c.req.valid('json')) }).where(byProject(s.storyEvents, c.req.param('id'), projectId)).returning().get(), '사건');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true as const, ...withTags(c.var.deps.db, 'events', [row])[0] });
  })
  .delete('/events/:id', (c) => {
    deleteItems(c.var.deps.db, c.req.param('projectId')!, 'events', [c.req.param('id')]);
    return c.json({ ok: true });
  })

  .get('/speech-rules', (c) => c.json(withTags(c.var.deps.db, 'speechRules', c.var.deps.db.select().from(s.speechRules).where(visible(s.speechRules, c.req.param('projectId')!)).all())))
  .get('/speech-rules/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const row = found(db.select().from(s.speechRules).where(byProject(s.speechRules, c.req.param('id'), projectId)).get(), '말투 규칙');
    return c.json(withTags(db, 'speechRules', [row])[0]);
  })
  .post('/speech-rules', validate('json', speechRuleInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = c.var.deps.db.insert(s.speechRules).values({ ...c.req.valid('json'), projectId }).returning().get();
    events.changed(projectId, 'knowledge');
    return c.json(withTags(c.var.deps.db, 'speechRules', [row])[0], 201);
  })
  .patch('/speech-rules/:id', validate('json', patchOf(speechRuleInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    const row = found(c.var.deps.db.update(s.speechRules).set({ ...c.req.valid('json'), ...byPerson(c.var.deps.db, s.speechRules, projectId, c.req.param('id'), c.req.valid('json')) }).where(byProject(s.speechRules, c.req.param('id'), projectId)).returning().get(), '말투 규칙');
    events.changed(projectId, 'knowledge');
    return c.json({ ok: true as const, ...withTags(c.var.deps.db, 'speechRules', [row])[0] });
  })
  .delete('/speech-rules/:id', (c) => {
    deleteItems(c.var.deps.db, c.req.param('projectId')!, 'speechRules', [c.req.param('id')]);
    return c.json({ ok: true });
  })
  /**
   * A person decides several items: confirm (a candidate becomes 확정; an AI-confirmed one is marked
   * 확인함) or discard. Either way a person set the status now. Items a person already decided are skipped.
   */
  /** The lines a speech rule governs (its pair, its stretch), with the speech levels their translations end in. */
  .get('/speech-rules/:id/lines', (c) => c.json(found(ruleLines(c.var.deps.db, c.req.param('projectId')!, c.req.param('id')) ?? undefined, '말투 규칙')))
  /** Work analyses (runs of analysis workflows, then the old service's jobs), newest first (#47). */
  .get('/analysis', (c) => c.json(listAnalyses(c.var.deps.db, c.req.param('projectId')!)))
  .post('/analysis/:jobId/cancel', (c) => {
    const { db, runner } = c.var.deps;
    const id = c.req.param('jobId');
    if (db.select({ id: s.runs.id }).from(s.runs).where(eq(s.runs.id, id)).get()) runner.cancel(id);
    else {
      // A job of the old analysis service (none runs any more after a restart).
      const job = db.update(s.analysisJobs).set({ status: 'cancelled', finishedAt: new Date() }).where(and(eq(s.analysisJobs.id, id), eq(s.analysisJobs.status, 'running'))).returning().get();
      if (job) events.changed(job.projectId, 'runs', 'analysis');
    }
    return c.json({ ok: true });
  })
  .post(
    '/drafts',
    validate('json', z.object({ kind: z.enum(draftKinds as [keyof typeof DRAFT_TABLES, ...(keyof typeof DRAFT_TABLES)[]]), ids: z.array(z.string()).min(1), action: z.enum(['confirm', 'discard']) })),
    (c) => {
      const projectId = c.req.param('projectId')!;
      const { kind, ids, action } = c.req.valid('json');
      const table = DRAFT_TABLES[kind];
      // Anything a person has not decided: candidates and items AI confirmed.
      const where = (slice: string[]) => and(eq(table.projectId, projectId), inArray(table.id, slice), or(eq(table.status, 'candidate'), eq(table.statusBy, 'ai')));
      const { db } = c.var.deps;
      // Chunked inside the one transaction: a bulk action can cover thousands of drafts.
      const changed = db.transaction((tx) => {
        let total = 0;
        eachChunk(ids, (slice) => {
          if (action === 'discard') {
            // Kept as rejected: a later analysis must not propose the same item again.
            total += tx.update(table).set({ status: 'rejected', statusBy: 'human' }).where(where(slice)).run().changes;
            clearReview(tx, projectId, kind, slice);
            return;
          }
          // A confirmed relationship needs confirmed people at both ends.
          if (kind === 'relationships') {
            const ends = tx.select({ fromId: s.relationships.fromId, toId: s.relationships.toId }).from(s.relationships).where(where(slice)).all().flatMap((r) => [r.fromId, r.toId]);
            eachChunk(ends, (people) => {
              tx.update(s.characters).set({ status: 'confirmed', statusBy: 'human' }).where(and(eq(s.characters.projectId, projectId), inArray(s.characters.id, people))).run();
            });
          }
          total += tx.update(table).set({ status: 'confirmed', statusBy: 'human' }).where(where(slice)).run().changes;
          clearReview(tx, projectId, kind, slice);
        }, 2_000);
        return total;
      });
      // Terms are cached under their own topic (the glossary), not with the story knowledge.
      events.changed(projectId, kind === 'terms' ? 'terms' : 'knowledge');
      return c.json({ changed });
    },
  )
  /** A person's tag on several knowledge items, or off them. The app's own tags are not put on by hand. */
  .post(
    '/knowledge-tags',
    validate('json', z.object({ kind: z.enum(KNOWLEDGE_TAG_KINDS), ids: z.array(z.string()).min(1), tagId: z.string(), add: z.boolean() })),
    (c) => {
      const projectId = c.req.param('projectId')!;
      const { kind, ids, tagId, add } = c.req.valid('json');
      const { db } = c.var.deps;
      found(db.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.id, tagId), eq(s.tags.projectId, projectId))).get(), '태그');
      const refusal = db.transaction((tx) => setKnowledgeTag(tx, projectId, kind, ids, tagId, add));
      if (refusal) badRequest(refusal);
      events.changed(projectId, kind === 'terms' ? 'terms' : 'knowledge');
      return c.json({ ok: true });
    },
  );

