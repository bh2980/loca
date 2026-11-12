import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { estimateTokens, termMarksOf, type ConditionData } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { inChunks } from '../db/chunk.ts';
import { tokensSql } from '../db/tokens.ts';
import type { FunctionInput } from './functions/types.ts';

/**
 * What the runner needs to know about a run's items beyond lines (WORKFLOW_SUBJECTS): terms are
 * read here — waiting order and the rows functions and conditions see. What a request shows of them
 * is in request.ts, with the lines'.
 */
type Item = typeof s.runItems.$inferSelect;
type Term = typeof s.terms.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A term in a request: its text plus roughly what its example lines add. */
const EXAMPLE_TOKENS = 40;
/** The size a term counts for when requests are packed (the waiting rows' `tokens`). */
export const termTokens = (source: string) => estimateTokens(source) + EXAMPLE_TOKENS;
/** Term items have no scene: they share one group, so batch rules that keep scenes whole do not apply. */
export const TERM_GROUP = 'terms';

/** The size factor a retry rule left on a queued item (1 for one never sent back), as a column of the waiting rows. */
export const RETRY_FACTOR = sql<number>`coalesce(${s.itemData.retryFactor}, 1)`;

/** The model a retry rule sends a queued item to its node on (a run.models key), or null: the node's own. Only counts at the AI node it was set for. */
export const RETRY_MODEL = sql<string | null>`case when ${s.itemData.retryModelNodeId} = ${s.runItems.nodeId} then ${s.itemData.retryModelKey} end`;

/** The order terms wait in at a node (so the order they are batched in): most used first, then by source. */
export const TERM_ORDER = [desc(sql`coalesce(${s.terms.lines}, 0)`), asc(s.terms.source)];

/** Queued term items at slow nodes that are due (not held by a retry rule's wait), most used first (then by source), with a position to batch by. */
export function waitingTerms(db: Db, runId: string, slowIds: string[], now: Date) {
  return db
    .select({
      id: s.runItems.id,
      unitId: s.runItems.subjectId,
      nodeId: s.runItems.nodeId,
      groupId: sql<string>`${TERM_GROUP}`,
      seq: sql<number>`0`,
      kind: sql<string>`'term'`,
      tokens: sql<number>`${tokensSql(s.terms.source)} + ${EXAMPLE_TOKENS}`,
      since: s.runItems.updatedAt,
      plan: s.runItems.plan,
      factor: RETRY_FACTOR,
      model: RETRY_MODEL,
    })
    .from(s.runItems)
    .innerJoin(s.terms, eq(s.terms.id, s.runItems.subjectId))
    .where(and(eq(s.runItems.runId, runId), eq(s.runItems.state, 'queued'), inArray(s.runItems.nodeId, slowIds), or(isNull(s.runItems.notBefore), lte(s.runItems.notBefore, now))))
    .orderBy(...TERM_ORDER)
    .all()
    .map((row, index) => ({ ...row, seq: index }));
}

/** Terms by id with their tags, for functions and conditions. */
export function loadTerms(db: Db | Tx, ids: string[]) {
  const terms = new Map(inChunks(ids, (chunk) => db.select().from(s.terms).where(inArray(s.terms.id, chunk)).all()).map((term) => [term.id, term]));
  const tags = Map.groupBy(
    inChunks([...terms.keys()], (chunk) => db.select({ itemId: s.knowledgeTags.itemId, tagId: s.knowledgeTags.tagId }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.kind, 'terms'), inArray(s.knowledgeTags.itemId, chunk))).all()),
    (row) => row.itemId,
  );
  return { terms, tagsOf: (id: string) => (tags.get(id) ?? []).map((row) => row.tagId) };
}

export const termInput = (run: { id: string; projectId: string }, item: Item, term: Term, tagIds: string[]): FunctionInput => ({ subject: 'terms', term, item, tagIds, projectId: run.projectId, runId: run.id });

/** What a condition reads about a term (ConditionData.term). */
export const termCondition = (term: Term, tagIds: string[]): NonNullable<ConditionData['term']> => ({
  status: term.status,
  statusBy: term.statusBy,
  hasTarget: Boolean(term.target.trim()),
  lines: term.lines,
  marks: termMarksOf(term),
  tagIds,
});
