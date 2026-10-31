import { Hono } from 'hono';
import { and, asc, eq, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { EVENT_LINK_KINDS, FEED_COLLECTIONS, KNOWLEDGE_TAG_KINDS, modelChoiceSchema, patchOf, withDuplicateTargets } from '@tw/shared';
import { badRequest, found, notFound, validate, type Env } from '../context.ts';
import { eachChunk, inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { deleteItems, deleteItemsKept, restoreItems } from '../services/item-delete.ts';
import { events } from '../events.ts';
import { characterRows, documentRows, feedSnapshot, relationshipRows, speechRuleRows } from '../feed.ts';
import { graphOrder, ruleLines } from '../services/speech.ts';
import { linkEvents, projectEventFlow, setEventLink } from '../services/event-routes.ts';
import { fillTermUsage, termUsage } from '../services/term-usage.ts';
import { saveCharacter } from '../services/characters.ts';
import { discoverAndSave, saveTerm } from '../services/terms.ts';
import { byPerson } from '../services/status-by.ts';
import { clearReview, setKnowledgeTag, withTags } from '../services/knowledge-tags.ts';
import { characterInput, documentInput, eventInput, relationshipInput, speechRuleInput, termInput } from '../schemas/knowledge.ts';

/** Tables whose rows a person confirms or discards as drafts. */
const DRAFT_TABLES = { documents: s.documents, characters: s.characters, relationships: s.relationships, events: s.storyEvents, speechRules: s.speechRules, terms: s.terms } as const;
export const draftKinds = Object.keys(DRAFT_TABLES) as (keyof typeof DRAFT_TABLES)[];

type ProjectTable = typeof s.terms | (typeof DRAFT_TABLES)[keyof typeof DRAFT_TABLES];
/** A project's rows a person sees: rejected ones stay stored (so an analysis does not propose them again) but are not listed. */
const visible = <T extends ProjectTable>(table: T, projectId: string) => and(eq(table.projectId, projectId), ne(table.status, 'rejected'));
const byProject = <T extends ProjectTable>(table: T, id: string, projectId: string) => and(eq(table.id, id), eq(table.projectId, projectId));

export const knowledgeRoutes = new Hono<Env>()
  /** A browser collection's rows and the feed's count: its first load, kept current by the change events' rows. */
  .get('/sync/:collection', validate('param', z.object({ collection: z.enum(FEED_COLLECTIONS) })), (c) => c.json(feedSnapshot(c.var.deps.db, c.req.param('projectId')!, c.req.valid('param').collection)))
  .get('/terms', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    fillTermUsage(db, projectId);
    return c.json(withTags(db, 'terms', withDuplicateTargets(db.select().from(s.terms).where(visible(s.terms, projectId)).orderBy(asc(s.terms.source)).all())));
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
    const saved = c.var.deps.db.transaction((tx) => saveTerm(tx, projectId, c.req.valid('json'), {}));
    if (!saved.ok) badRequest(saved.error);
    events.changed(projectId, 'terms');
    return c.json(saved.row, 201);
  })
  .patch('/terms/:id', validate('json', patchOf(termInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    const saved = c.var.deps.db.transaction((tx) => saveTerm(tx, projectId, c.req.valid('json'), { id: c.req.param('id') }));
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

  .get('/documents', (c) => c.json(documentRows(c.var.deps.db, c.req.param('projectId')!)))
  .get('/documents/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId')!;
    const row = found(db.select().from(s.documents).where(byProject(s.documents, c.req.param('id'), projectId)).get(), '노트');
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
    return c.json({ characters: characterRows(db, projectId), relationships: relationshipRows(db, projectId) });
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
  /** Deletes a graph's selection (people, relationships, speech rules; events, their lines) and returns a token ⌘/Ctrl+Z restores it with. */
  .post('/knowledge-delete', validate('json', z.object({ items: z.array(z.object({ kind: z.enum(['characters', 'relationships', 'speechRules', 'events', 'eventLinks']), ids: z.array(z.string()).min(1) })).min(1) })), (c) =>
    c.json(deleteItemsKept(c.var.deps.db, c.req.param('projectId')!, c.req.valid('json').items)),
  )
  /** Puts back what a knowledge-delete removed (its token), for ⌘/Ctrl+Z. */
  .post('/knowledge-restore', validate('json', z.object({ token: z.string().min(1) })), (c) => {
    if (!restoreItems(c.var.deps.db, c.req.param('projectId')!, c.req.valid('json').token)) badRequest('되돌릴 수 없습니다. 삭제한 지 오래되었거나 서버가 다시 시작되었습니다.');
    return c.json({ ok: true as const });
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
  .get('/events', (c) => c.json(projectEventFlow(c.var.deps.db, c.req.param('projectId')!)))
  /** Draws a line between two events or takes one away, as link_events does (by a person); says what the pair had before, for ⌘/Ctrl+Z. */
  .post('/event-links', validate('json', z.object({ fromId: z.string().min(1), toId: z.string().min(1), action: z.enum(['link', 'unlink']) })), (c) => {
    try {
      return c.json(linkEvents(c.var.deps.db, c.req.param('projectId')!, { ...c.req.valid('json'), origin: 'human' }));
    } catch (error) {
      return badRequest((error as Error).message);
    }
  })
  /** Puts a pair's correction back as it was (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z). */
  .put('/event-links', validate('json', z.object({ fromId: z.string().min(1), toId: z.string().min(1), kind: z.enum(EVENT_LINK_KINDS).nullable() })), (c) => {
    if (!setEventLink(c.var.deps.db, c.req.param('projectId')!, { ...c.req.valid('json'), origin: 'human' })) badRequest('같은 프로젝트의 서로 다른 두 사건만 이을 수 있습니다.');
    return c.json({ ok: true as const });
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

  .get('/speech-rules', (c) => c.json(speechRuleRows(c.var.deps.db, c.req.param('projectId')!)))
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

