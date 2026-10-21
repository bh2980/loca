import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { termMarksOf, type AiNode, type ConditionData } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { inChunks } from '../db/chunk.ts';
import { buildContext } from '../services/context.ts';
import type { FunctionInput } from './functions/types.ts';
import { promptLineId, type PromptLine } from './prompts.ts';

/**
 * What the runner needs to know about a run's items beyond lines (WORKFLOW_SUBJECTS): terms are
 * read here — waiting order, the rows functions and conditions see, and what a prompt shows of them.
 * Lines stay in the runner, where they always were.
 */
type Item = typeof s.runItems.$inferSelect;
type Term = typeof s.terms.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A term in a request: its text plus roughly what its example lines add. */
const EXAMPLE_TOKENS = 40;
/** Term items have no scene: they share one group, so batch rules that keep scenes whole do not apply. */
export const TERM_GROUP = 'terms';

/** The size factor a 재요청 node left on a queued item (1 for one never sent back), as a column of the waiting rows. */
export const RETRY_FACTOR = sql<number>`coalesce(json_extract(${s.runItems.data}, '$.retry.factor'), 1)`;

/** Queued term items at slow nodes, most used first (then by source), with a position to batch by. */
export function waitingTerms(db: Db, runId: string, slowIds: string[]) {
  return db
    .select({
      id: s.runItems.id,
      unitId: s.runItems.subjectId,
      nodeId: s.runItems.nodeId,
      groupId: sql<string>`${TERM_GROUP}`,
      seq: sql<number>`0`,
      kind: sql<string>`'term'`,
      tokens: sql<number>`(length(cast(${s.terms.source} as blob)) + 3) / 4 + ${EXAMPLE_TOKENS}`,
      since: s.runItems.updatedAt,
      plan: s.runItems.plan,
      factor: RETRY_FACTOR,
    })
    .from(s.runItems)
    .innerJoin(s.terms, eq(s.terms.id, s.runItems.subjectId))
    .where(and(eq(s.runItems.runId, runId), eq(s.runItems.state, 'queued'), inArray(s.runItems.nodeId, slowIds)))
    .orderBy(desc(sql`coalesce(${s.terms.lines}, 0)`), asc(s.terms.source))
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

/**
 * Term items as a prompt shows them ("T1"…): the term, its current Korean form and note, how many
 * lines use it, and up to `context.examples` of those lines with their translations. The rows are
 * those example lines, so the request's context (glossary, characters, documents…) is chosen from
 * what the examples say.
 */
export function termPrompt(db: Db, projectId: string, items: Item[], node: AiNode) {
  const { terms } = loadTerms(db, items.map((item) => item.subjectId));
  const count = node.config.context.examples;
  const keys = [...new Set(items.flatMap((item) => terms.get(item.subjectId)?.examples.slice(0, count) ?? []))];
  const units = new Map(inChunks(keys, (chunk) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, chunk))).all()).map((unit) => [unit.key, unit]));
  // One prompt item per run item, in order: the answer is read back by position.
  const lines: PromptLine[] = items.flatMap((item, index): PromptLine[] => {
    const term = terms.get(item.subjectId);
    if (!term) return [{ id: promptLineId(index, 'T'), unitId: item.subjectId, groupId: TERM_GROUP, key: item.subjectId, kind: 'term', speaker: null, source: '', term: { examples: [] } }];
    const examples = term.examples.slice(0, count).flatMap((key) => {
      const unit = units.get(key);
      return unit ? [{ speaker: unit.speaker ?? undefined, source: unit.source, translation: unit.translation ?? undefined }] : [];
    });
    return [
      {
        id: promptLineId(index, 'T'),
        unitId: term.id,
        groupId: TERM_GROUP,
        key: term.source,
        kind: 'term',
        speaker: null,
        source: term.source,
        candidate: item.data.candidateText ?? (term.target || undefined),
        issues: item.data.issues,
        term: { target: term.target || undefined, note: term.note || undefined, uses: term.lines ?? undefined, examples },
      },
    ];
  });
  // The context is chosen from the terms themselves (a confirmed "Brin" goes with "Brin Guild") and
  // from their example lines, so 확정 용어 works without examples too.
  const own = items.flatMap((item) => {
    const term = terms.get(item.subjectId);
    return term ? [{ id: `term:${term.id}`, key: `term:${term.id}`, groupId: TERM_GROUP, sort: 0, speaker: null, source: term.source }] : [];
  });
  const context = buildContext(db, projectId, [...own, ...units.values()], { ...node.config.context, precedingLines: 0, previousScenes: 0, speech: false });
  // A term being translated is not its own context.
  const asked = new Set(own.map((row) => row.source.toLowerCase()));
  context.terms = context.terms.filter((term) => !asked.has(term.source.toLowerCase()));
  context.items = context.items.filter((item) => item.kind !== 'term' || !asked.has(item.label.split(' → ')[0]!.toLowerCase()));
  return { lines, context };
}
