import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { EVENT_LINK_KINDS, HELD_COLLECTIONS, HELD_READ_MAX, relationshipChangeSchema, SNAPSHOT_COLLECTIONS, KNOWLEDGE_TAG_KINDS, patchOf, type KnowledgeTagKind } from '@tw/shared';
import { badRequest, found, notFound, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { deleteItemGroups, deleteItems } from '../services/item-delete.ts';
import { feedSnapshot, heldRows } from '../feed.ts';
import { ruleLines } from '../services/speech.ts';
import { linkEvents, setEventLink } from '../services/event-routes.ts';
import { termUsage } from '../services/term-usage.ts';
import { decideDrafts, DRAFT_KINDS, saveCharacterItem, saveKnowledgeItem, saveRelationshipItem, setRelationshipChanges, type SaveResult } from '../services/knowledge-save.ts';
import { discoverAndSave, saveTerm } from '../services/terms.ts';
import { setKnowledgeTag, withTags } from '../services/knowledge-tags.ts';
import { characterInput, documentInput, eventInput, relationshipInput, speechRuleInput, termInput } from '../schemas/knowledge.ts';

/** The knowledge tables a person edits one item at a time, by the kind their tags name them with. */
const ITEMS = {
  documents: { table: s.documents, what: '노트' },
  characters: { table: s.characters, what: '인물' },
  relationships: { table: s.relationships, what: '관계' },
  events: { table: s.storyEvents, what: '사건' },
  speechRules: { table: s.speechRules, what: '말투 규칙' },
} as const satisfies Partial<Record<KnowledgeTagKind, unknown>>;
type ItemKind = keyof typeof ITEMS;

/** One item of the project with its tags, as the app's panes show it. */
function item<K extends ItemKind>(db: Db, projectId: string, kind: K, id: string) {
  // One id/projectId column shape across these tables; the cast only picks it.
  const table = ITEMS[kind].table as typeof s.documents;
  const row = found(db.select().from(table).where(and(eq(table.id, id), eq(table.projectId, projectId))).get(), ITEMS[kind].what) as (typeof ITEMS)[K]['table']['$inferSelect'];
  return withTags(db, kind, [row])[0]!;
}

/** A save's outcome as the app answers it: the saved item, or the service's refusal (404 when the item is not there). */
function saved<K extends ItemKind>(db: Db, projectId: string, kind: K, result: SaveResult) {
  if (!result.ok) return result.missing ? notFound(ITEMS[kind].what) : badRequest(result.error);
  return item(db, projectId, kind, result.id);
}

export const knowledgeRoutes = new Hono<Env>()
  /** A browser collection's rows and the feed's count: its first load, kept current by the change events' rows. */
  .get('/sync/:collection', validate('param', z.object({ collection: z.enum(SNAPSHOT_COLLECTIONS) })), (c) => c.json(feedSnapshot(c.var.deps.db, c.var.deps, c.req.param('projectId')!, c.req.valid('param').collection)))
  /** A held collection's rows by id (the lines, run items, proposals or AI calls a screen shows), with the feed's count when read. */
  .post('/sync/:collection', validate('param', z.object({ collection: z.enum(HELD_COLLECTIONS) })), validate('json', z.object({ ids: z.array(z.string()).max(HELD_READ_MAX) })), (c) =>
    c.json(heldRows(c.var.deps.db, c.var.deps, c.req.param('projectId')!, c.req.valid('param').collection, c.req.valid('json').ids)),
  )
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
    const term = found(db.select().from(s.terms).where(and(eq(s.terms.id, c.req.param('id')), eq(s.terms.projectId, projectId))).get(), '용어');
    const rows = termUsage(db, projectId, term);
    // Ids only: the pane shows the first lines from the browser's units collection.
    return c.json({ count: rows.length, unitIds: rows.map((row) => row.id) });
  })
  .post('/terms', validate('json', termInput), (c) => {
    const projectId = c.req.param('projectId')!;
    const saved = c.var.deps.db.transaction((tx) => saveTerm(tx, projectId, c.req.valid('json'), {}));
    if (!saved.ok) badRequest(saved.error);
    return c.json(saved.row, 201);
  })
  .patch('/terms/:id', validate('json', patchOf(termInput)), (c) => {
    const projectId = c.req.param('projectId')!;
    const saved = c.var.deps.db.transaction((tx) => saveTerm(tx, projectId, c.req.valid('json'), { id: c.req.param('id') }));
    if (!saved.ok) {
      if (saved.reason === 'missing') notFound('용어');
      badRequest(saved.error);
    }
    return c.json({ ok: true });
  })
  .delete('/terms/:id', (c) => c.json(deleteItems(c.var.deps.db, c.req.param('projectId')!, 'terms', [c.req.param('id')])))

  // People, relationships, events, notes and speech rules: the app saves them as a person, through the same services
  // as the agent's save_* tools (services/knowledge-save.ts), so both are held to the same rules.
  .get('/documents/:id', (c) => c.json(item(c.var.deps.db, c.req.param('projectId')!, 'documents', c.req.param('id'))))
  .post('/documents', validate('json', documentInput), (c) => c.json(saved(c.var.deps.db, c.req.param('projectId')!, 'documents', saveKnowledgeItem(c.var.deps.db, c.req.param('projectId')!, 'documents', c.req.valid('json'))), 201))
  .patch('/documents/:id', validate('json', patchOf(documentInput)), (c) =>
    c.json({ ok: true as const, ...saved(c.var.deps.db, c.req.param('projectId')!, 'documents', saveKnowledgeItem(c.var.deps.db, c.req.param('projectId')!, 'documents', { ...c.req.valid('json'), id: c.req.param('id') })) }),
  )
  .delete('/documents/:id', (c) => c.json(deleteItems(c.var.deps.db, c.req.param('projectId')!, 'documents', [c.req.param('id')])))

  .get('/characters/:id', (c) => c.json(item(c.var.deps.db, c.req.param('projectId')!, 'characters', c.req.param('id'))))
  .post('/characters', validate('json', characterInput), (c) => c.json(saved(c.var.deps.db, c.req.param('projectId')!, 'characters', saveCharacterItem(c.var.deps.db, c.req.param('projectId')!, c.req.valid('json'))), 201))
  .patch('/characters/:id', validate('json', patchOf(characterInput)), (c) =>
    c.json({ ok: true as const, ...saved(c.var.deps.db, c.req.param('projectId')!, 'characters', saveCharacterItem(c.var.deps.db, c.req.param('projectId')!, { ...c.req.valid('json'), id: c.req.param('id') })) }),
  )
  .delete('/characters/:id', (c) => c.json(deleteItems(c.var.deps.db, c.req.param('projectId')!, 'characters', [c.req.param('id')])))
  /**
   * Deletes a graph's selection (people, relationships, speech rules; events, their lines) with what goes with it, and
   * answers with the token POST /undo puts it all back with (⌘/Ctrl+Z).
   */
  .post('/knowledge-delete', validate('json', z.object({ items: z.array(z.object({ kind: z.enum(['characters', 'relationships', 'speechRules', 'events', 'eventLinks']), ids: z.array(z.string()).min(1) })).min(1) })), (c) =>
    c.json(deleteItemGroups(c.var.deps.db, c.req.param('projectId')!, c.req.valid('json').items)),
  )
  .get('/relationships/:id', (c) => c.json(item(c.var.deps.db, c.req.param('projectId')!, 'relationships', c.req.param('id'))))
  /** A relationship's changes alone (관계 변화); its own status and content stay. */
  .patch('/relationships/:id/changes', validate('json', z.object({ changes: z.array(relationshipChangeSchema) })), (c) => {
    if (!setRelationshipChanges(c.var.deps.db, c.req.param('projectId')!, c.req.param('id'), c.req.valid('json').changes)) notFound('관계');
    return c.json({ ok: true });
  })
  .post('/relationships', validate('json', relationshipInput), (c) => c.json(saved(c.var.deps.db, c.req.param('projectId')!, 'relationships', saveRelationshipItem(c.var.deps.db, c.req.param('projectId')!, c.req.valid('json'))), 201))
  .patch('/relationships/:id', validate('json', patchOf(relationshipInput)), (c) =>
    c.json({ ok: true as const, ...saved(c.var.deps.db, c.req.param('projectId')!, 'relationships', saveRelationshipItem(c.var.deps.db, c.req.param('projectId')!, { ...c.req.valid('json'), id: c.req.param('id') })) }),
  )
  .delete('/relationships/:id', (c) => c.json(deleteItems(c.var.deps.db, c.req.param('projectId')!, 'relationships', [c.req.param('id')])))
  /** Draws a line between two events or takes one away, as link_events does (by a person); says what the pair had before, for ⌘/Ctrl+Z. */
  .post('/event-links', validate('json', z.object({ fromId: z.string().min(1), toId: z.string().min(1), action: z.enum(['link', 'unlink']) })), (c) => c.json(linkEvents(c.var.deps.db, c.req.param('projectId')!, { ...c.req.valid('json'), origin: 'human' })))
  /** Puts a pair's correction back as it was (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z). */
  .put('/event-links', validate('json', z.object({ fromId: z.string().min(1), toId: z.string().min(1), kind: z.enum(EVENT_LINK_KINDS).nullable() })), (c) => {
    if (!setEventLink(c.var.deps.db, c.req.param('projectId')!, { ...c.req.valid('json'), origin: 'human' })) badRequest('같은 프로젝트의 서로 다른 두 사건만 이을 수 있습니다.');
    return c.json({ ok: true as const });
  })
  .get('/events/:id', (c) => c.json(item(c.var.deps.db, c.req.param('projectId')!, 'events', c.req.param('id'))))
  .post('/events', validate('json', eventInput), (c) => c.json(saved(c.var.deps.db, c.req.param('projectId')!, 'events', saveKnowledgeItem(c.var.deps.db, c.req.param('projectId')!, 'events', c.req.valid('json'))), 201))
  .patch('/events/:id', validate('json', patchOf(eventInput)), (c) =>
    c.json({ ok: true as const, ...saved(c.var.deps.db, c.req.param('projectId')!, 'events', saveKnowledgeItem(c.var.deps.db, c.req.param('projectId')!, 'events', { ...c.req.valid('json'), id: c.req.param('id') })) }),
  )
  .delete('/events/:id', (c) => c.json(deleteItems(c.var.deps.db, c.req.param('projectId')!, 'events', [c.req.param('id')])))

  .get('/speech-rules/:id', (c) => c.json(item(c.var.deps.db, c.req.param('projectId')!, 'speechRules', c.req.param('id'))))
  .post('/speech-rules', validate('json', speechRuleInput), (c) => c.json(saved(c.var.deps.db, c.req.param('projectId')!, 'speechRules', saveKnowledgeItem(c.var.deps.db, c.req.param('projectId')!, 'speechRules', c.req.valid('json'))), 201))
  .patch('/speech-rules/:id', validate('json', patchOf(speechRuleInput)), (c) =>
    c.json({ ok: true as const, ...saved(c.var.deps.db, c.req.param('projectId')!, 'speechRules', saveKnowledgeItem(c.var.deps.db, c.req.param('projectId')!, 'speechRules', { ...c.req.valid('json'), id: c.req.param('id') })) }),
  )
  .delete('/speech-rules/:id', (c) => c.json(deleteItems(c.var.deps.db, c.req.param('projectId')!, 'speechRules', [c.req.param('id')])))
  /** The lines a speech rule governs (its pair, its stretch), with the speech levels their translations end in. */
  .get('/speech-rules/:id/lines', (c) => c.json(found(ruleLines(c.var.deps.db, c.req.param('projectId')!, c.req.param('id')) ?? undefined, '말투 규칙')))
  /** A person decides several items: confirm or discard (services/knowledge-save.ts decideDrafts). */
  .post('/drafts', validate('json', z.object({ kind: z.enum(DRAFT_KINDS), ids: z.array(z.string()).min(1), action: z.enum(['confirm', 'discard']) })), (c) => {
    const { kind, ids, action } = c.req.valid('json');
    return c.json({ changed: decideDrafts(c.var.deps.db, c.req.param('projectId')!, kind, ids, action) });
  })
  /** A person's tag on several knowledge items, or off them. The app's own tags are not put on by hand. */
  .post('/knowledge-tags', validate('json', z.object({ kind: z.enum(KNOWLEDGE_TAG_KINDS), ids: z.array(z.string()).min(1), tagId: z.string(), add: z.boolean() })), (c) => {
    const { kind, ids, tagId, add } = c.req.valid('json');
    const refusal = c.var.deps.db.transaction((tx) => setKnowledgeTag(tx, c.req.param('projectId')!, kind, ids, tagId, add));
    if (refusal) badRequest(refusal);
    return c.json({ ok: true });
  });
