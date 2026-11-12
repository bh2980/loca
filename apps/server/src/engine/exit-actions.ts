/**
 * 출구 동작: what a line gets as it leaves a node's exit, before the exit's lines split.
 * An error exit first checks the retry rule; a line sent again gets no action, it has not left yet. A line that leaves an
 * exit with no line after it ends completed when an action set its status, failed when an error exit only tagged it.
 * Actions are not nodes, so they never count as a visit; a line that comes round a loop gets them again.
 * The runner calls applyExitActions inside the step's transaction, once per item and exit, in the order the actions
 * are listed; nothing here counts as a visit. What a node used to guard still holds: a status a person gave a line keeps
 * its translation (a run that picks lines by status), a tag that may not go on this kind of item is skipped.
 */
import { and, desc, eq, or } from 'drizzle-orm';
import { get } from 'es-toolkit/compat';
import { filtersByStatus, KNOWLEDGE_STATUSES, previousStepId, type ExitAction, type KnowledgeStatus, type TagExitAction, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { setKnowledgeTag } from '../services/knowledge-tags.ts';
import { attachUnitTags } from '../services/tag-scope.ts';
import { HUMAN_OWNED_NOTE, personOwns } from './apply-candidate.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Run = Pick<typeof s.runs.$inferSelect, 'id' | 'projectId' | 'subject' | 'scope' | 'tags'> & { definition: WorkflowDefinition };
type Item = Pick<typeof s.runItems.$inferSelect, 'subjectId'> & { data: Pick<typeof s.runItems.$inferSelect['data'], 'path' | 'outputs' | 'candidateText'> };

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();
const namesIn = (value: unknown): string[] => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]).map((entry) => String(entry).trim()).filter(Boolean);

/**
 * The tags an action puts on or takes off: those it names, and with `fromField` each value of that field of the step's
 * result, as the tag `categoryTags` connects it to or the tag of that name. `unmatched` are the values no tag answers
 * (an AI naming a kind the project has no tag for): they are not made, only counted.
 */
function tagsOf(tx: Tx, run: Run, action: TagExitAction, result: Record<string, unknown> | undefined) {
  const scope = run.subject === 'terms' ? 'terms' : 'lines';
  const tags = tx.select({ id: s.tags.id, name: s.tags.name, scope: s.tags.scope }).from(s.tags).where(eq(s.tags.projectId, run.projectId)).all();
  const ids = new Set(action.tagIds);
  const unmatched: string[] = [];
  if (action.fromField)
    for (const name of namesIn(get(result, action.fromField))) {
      const connected = action.categoryTags[name] ?? action.categoryTags[lower(name)];
      const tag = tags.find((candidate) => candidate.id === connected) ?? tags.find((candidate) => lower(candidate.name) === lower(name) && candidate.scope.includes(scope));
      if (tag) ids.add(tag.id);
      else unmatched.push(name);
    }
  return { ids: [...ids], unmatched };
}

/**
 * A tag the run put on that was deleted while it ran is made again as it was when the run started (its id, name,
 * colour, places), so the line still gets it. A tag the run never knew is left alone.
 */
function restoreTags(tx: Tx, run: Run, ids: readonly string[]) {
  const there = new Set(tx.select({ id: s.tags.id }).from(s.tags).where(eq(s.tags.projectId, run.projectId)).all().map((tag) => tag.id));
  for (const id of ids) {
    if (there.has(id)) continue;
    const kept = run.tags.find((tag) => tag.id === id);
    if (kept) tx.insert(s.tags).values({ id: kept.id, projectId: run.projectId, name: kept.name, color: kept.color, scope: kept.scope, description: kept.description }).onConflictDoNothing().run();
  }
}

/** What a run says when it leaves a status a person set (scope.changeHuman off). */
export const HUMAN_STATUS_NOTE = '사람이 정한 상태라 바꾸지 않았습니다.';

/**
 * Applies an exit's actions to the item; returns the notes for the run's detail (a person's status kept, a tag not
 * found…). The line's history knows the tags it changed came from this run (event_actor, read by the line_events
 * triggers).
 */
export function applyExitActions(tx: Tx, run: Run, item: Item, nodeId: string, port: string, actions: readonly ExitAction[]): string[] {
  if (!actions.length) return [];
  tx.insert(s.eventActor).values({ one: 1, runId: run.id }).onConflictDoUpdate({ target: s.eventActor.one, set: { runId: run.id } }).run();
  try {
    return applyActions(tx, run, item, nodeId, port, actions);
  } finally {
    tx.delete(s.eventActor).run();
  }
}

function applyActions(tx: Tx, run: Run, item: Item, nodeId: string, port: string, actions: readonly ExitAction[]): string[] {
  const notes: string[] = [];
  // What a `fromField` reads: the result of this node, or of the step before it (previousStepId skips 오류 exits and nodes without a result).
  const step = previousStepId(run.definition, [...item.data.path, { nodeId, port }]);
  const result = step ? (item.data.outputs?.[step] as Record<string, unknown> | undefined) : undefined;

  if (run.subject === 'terms') {
    for (const action of actions) {
      if (action.type === 'status') {
        if (!(KNOWLEDGE_STATUSES as readonly string[]).includes(action.statusId)) throw new Error('용어의 상태는 후보·확정·버림 중 하나입니다.');
        tx.update(s.terms).set({ status: action.statusId as KnowledgeStatus, statusBy: 'ai', runId: run.id }).where(eq(s.terms.id, item.subjectId)).run();
        continue;
      }
      const { ids, unmatched } = tagsOf(tx, run, action, result);
      for (const name of unmatched) notes.push(`없는 태그 이름: ${name}`);
      if (action.action === 'add') restoreTags(tx, run, ids);
      for (const id of ids) {
        const refused = setKnowledgeTag(tx, run.projectId, 'terms', [item.subjectId], id, action.action === 'add');
        if (refused) notes.push(refused);
      }
    }
    return notes;
  }

  // What a person decided stays unless the run was asked to change it too (scope.changeHuman): a status a person set,
  // a tag a person put on, by the line's history (the last change of it was not a run's).
  const keepHuman = !run.scope.changeHuman;
  const lastBy = (kind: 'status' | 'tag', tagId?: string) => tx.select({ runId: s.lineEvents.runId, after: s.lineEvents.after }).from(s.lineEvents)
    .where(and(eq(s.lineEvents.unitId, item.subjectId), eq(s.lineEvents.kind, kind), ...(tagId ? [or(eq(s.lineEvents.after, tagId), eq(s.lineEvents.before, tagId))] : [])))
    .orderBy(desc(s.lineEvents.id)).limit(1).get();
  for (const action of actions) {
    if (action.type === 'status') {
      if (!action.statusId) continue;
      // A run that picks lines by status never replaces what a person decided (#51): the line keeps its status.
      const current = tx.select({ translation: s.units.translation, statusBy: s.units.statusBy, statusId: s.units.statusId }).from(s.units).where(and(eq(s.units.id, item.subjectId), eq(s.units.projectId, run.projectId))).get();
      if (personOwns(current, item.data.candidateText, filtersByStatus(run.scope))) {
        notes.push(HUMAN_OWNED_NOTE);
        continue;
      }
      const last = lastBy('status');
      if (keepHuman && current?.statusId !== action.statusId && last && !last.runId) {
        notes.push(HUMAN_STATUS_NOTE);
        continue;
      }
      tx.update(s.units).set({ statusId: action.statusId, statusBy: 'ai', statusRunId: run.id }).where(eq(s.units.id, item.subjectId)).run();
      continue;
    }
    const { ids, unmatched } = tagsOf(tx, run, action, result);
    for (const name of unmatched) notes.push(`없는 태그 이름: ${name}`);
    if (!ids.length) continue;
    if (action.action === 'add') restoreTags(tx, run, ids);
    // A tag a person put on is not taken off by a run that was not asked to.
    const kept = action.action === 'remove' && keepHuman ? ids.filter((id) => { const last = lastBy('tag', id); return last && !last.runId && last.after === id; }) : [];
    for (const id of kept) notes.push(`사람이 붙인 태그 ‘${tx.select({ name: s.tags.name }).from(s.tags).where(eq(s.tags.id, id)).get()?.name ?? id}’는 떼지 않았습니다.`);
    const changing = ids.filter((id) => !kept.includes(id));
    if (!changing.length) continue;
    const { skipped } = attachUnitTags(tx, run.projectId, [item.subjectId], action.action === 'add' ? { add: changing } : { remove: changing }, { onMisplaced: 'skip' });
    for (const tag of skipped) notes.push(`‘${tag.name}’ 태그는 대사에 붙일 수 없어 붙이지 않았습니다.`);
  }
  return notes;
}
