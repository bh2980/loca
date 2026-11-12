import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import jsonLogic from 'json-logic-js';
import { SPEECH_LEVEL_LABELS, functionTakes, isUnknownListener, lineMarksOf, pickPaths, previousStepId, runNodeName, type ConditionData, type FunctionName, type WorkflowNode } from '@tw/shared';
import { inChunks } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { Topic } from '../events.ts';
import { knowledgeOf, speechRuleIndex } from '../services/speech.ts';
import { APPLY_TOPICS } from './functions/apply.ts';
import { syncFunctions, type FunctionInput } from './functions/index.ts';
import { nodeOf, record, route, type Item, type Run, type Tx } from './run-state.ts';
import { loadTerms, termCondition, termInput } from './subjects.ts';

export type GatherNode = Extract<WorkflowNode, { type: 'gather' }>;

/*
 * The nodes of a run that finish at once, inside a transaction: entry, conditions, functions that do not
 * wait for anything, and a gather closing. The scheduler hands them items; they record and route.
 */

/** Functions that write beyond the line itself, and the change topic they touch. */
const FUNCTION_TOPICS: Record<string, Topic[]> = { ...APPLY_TOPICS };

/** Why a node of the other input sends an item out through "error" (validation keeps such nodes out; a safety net). */
const unsupported = (run: Run, node: WorkflowNode) => `'${runNodeName(run.definition, node)}' 노드는 ${run.subject === 'terms' ? '용어' : '대사'}에 쓸 수 없어 오류 출구로 보냈습니다.`;

/** Runs instant nodes for `items` until `deadline` (the rest stay queued for the next tick); returns the extra topics their functions wrote to. */
export function settle(db: Db, run: Run, items: Item[], deadline: number): Set<Topic> {
  const topics = new Set<Topic>();
  for (const item of items) {
    const node = nodeOf(run, item.nodeId);
    for (const topic of node?.type === 'function' ? (FUNCTION_TOPICS[node.config.fn] ?? []) : []) topics.add(topic);
    // A term's status or tags set by an exit action (a line's reach the screens through the row feed).
    if (run.subject === 'terms' && Object.keys(node?.exits ?? {}).length) topics.add('terms');
  }
  db.transaction((tx) => {
    if (run.subject === 'terms') {
      const { terms, tagsOf } = loadTerms(tx, items.map((item) => item.subjectId));
      for (const item of items) {
        const node = nodeOf(run, item.nodeId);
        const term = terms.get(item.subjectId);
        if (!node || !term) {
          tx.update(s.runItems).set({ state: 'failed', error: '노드 또는 용어가 없습니다.' }).where(eq(s.runItems.id, item.id)).run();
          continue;
        }
        runInstant(tx, run, node, item, termInput(run, item, term, tagsOf(term.id)));
        if (performance.now() >= deadline) return;
      }
      return;
    }
    const unitRows = new Map(inChunks(items.map((item) => item.subjectId), (ids) => tx.select().from(s.units).where(inArray(s.units.id, ids)).all()).map((unit) => [unit.id, unit]));
    const tagRows = Map.groupBy(inChunks([...unitRows.keys()], (ids) => tx.select().from(s.unitTags).where(inArray(s.unitTags.unitId, ids)).all()), (row) => row.unitId);
    for (const item of items) {
      const node = nodeOf(run, item.nodeId);
      const unit = unitRows.get(item.subjectId);
      if (!node || !unit) {
        tx.update(s.runItems).set({ state: 'failed', error: '노드 또는 원문이 없습니다.' }).where(eq(s.runItems.id, item.id)).run();
        continue;
      }
      runInstant(tx, run, node, item, { subject: 'lines', unit, item, tagIds: (tagRows.get(unit.id) ?? []).map((row) => row.tagId), projectId: run.projectId, runId: run.id });
      if (performance.now() >= deadline) return;
    }
  });
  return topics;
}

function runInstant(tx: Tx, run: Run, node: WorkflowNode, item: Item, input: FunctionInput) {
  switch (node.type) {
    case 'entry':
      return route(tx, run, item, 'out');
    case 'condition': {
      const common = { visits: item.visits, outputs: item.data.outputs ?? {}, issues: item.data.issues ?? [], error: item.data.error ?? null };
      let data: ConditionData;
      if (input.subject === 'terms') data = { ...common, candidate: item.data.candidateText ?? (input.term.target || null), term: termCondition(input.term, input.tagIds) };
      else {
        const unit = input.unit;
        const finalStatus = tx.select({ kind: s.statuses.kind }).from(s.statuses).where(eq(s.statuses.id, unit.statusId)).get()?.kind === 'final';
        const rules = knowledgeOf(tx as unknown as Db, run.projectId).settings()?.formatRules;
        const suggested = Boolean(tx.select({ id: s.candidates.id }).from(s.candidates).where(and(eq(s.candidates.unitId, unit.id), eq(s.candidates.state, 'pending'))).get());
        const marks = lineMarksOf({ suggested });
        // Only a condition that reads the line's speech rule pays for resolving it.
        const rule = JSON.stringify(node.config.expression ?? null).includes('unit.speechLevel') ? speechRuleIndex(tx as unknown as Db, run.projectId).resolve([unit]).get(unit.key)?.rule : undefined;
        data = { ...common, candidate: item.data.candidateText ?? unit.translation, unit: { kind: unit.kind, speaker: unit.speaker, listener: unit.listener, listenerUnknown: isUnknownListener(unit, rules), statusId: unit.statusId, final: finalStatus, statusBy: unit.statusBy, noted: unit.note.trim() !== '', tagIds: input.tagIds, marks, speechLevel: rule ? SPEECH_LEVEL_LABELS[rule.level] : null } };
      }
      try {
        return route(tx, run, item, jsonLogic.apply(node.config.expression as jsonLogic.RulesLogic, data) ? 'true' : 'false');
      } catch (error) {
        return route(tx, run, item, 'error', `조건식 오류: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    case 'function': {
      if (!functionTakes(node.config.fn, run.subject)) return route(tx, run, item, 'error', unsupported(run, node), 'unsupported');
      const fn = syncFunctions[node.config.fn as FunctionName];
      if (!fn) return route(tx, run, item, 'error', `알 수 없는 함수입니다: ${node.config.fn}`);
      // Like an async function's input: the result of the step before it on the item's way here.
      const previousStep = previousStepId(run.definition, item.data.path);
      if (previousStep) input = { ...input, previous: item.data.outputs?.[previousStep] as Record<string, unknown> | undefined };
      try {
        return record(tx, run, item, fn(tx, node.config.params, input));
      } catch (error) {
        return route(tx, run, item, 'error', error instanceof Error ? error.message : String(error));
      }
    }
    default:
      return route(tx, run, item, 'error', '즉시 실행할 수 없는 노드입니다.');
  }
}

/**
 * Closes every gather whose upstream nodes have nothing open left: the answers its items carry
 * from the previous step (each item's result node before it; batch answers once, from their first item) become outputs.<gather> = { parts,
 * count, failed } on one item, which leaves through "out"; the others end at the gather.
 * `open` counts the lines still queued or running per node, `upstream` names every node that can reach each node.
 * True when one closed.
 */
export function closeGathers(db: Db, run: Run, gathers: GatherNode[], open: Map<string, number>, upstream: Map<string, Set<string>>) {
  let closed = false;
  for (const gather of gathers) {
    if (!(open.get(gather.id) ?? 0)) continue;
    const before = [...(upstream.get(gather.id) ?? [])].filter((id) => id !== gather.id);
    if (before.some((id) => (open.get(id) ?? 0) > 0)) continue;
    db.transaction((tx) => {
      const items = tx.select().from(s.runItems).where(and(eq(s.runItems.runId, run.id), eq(s.runItems.nodeId, gather.id), eq(s.runItems.state, 'queued'))).orderBy(asc(sql`rowid`)).all();
      const { fields } = gather.config;
      // Each item's previous step: the result node before the gather on its way here.
      const parts = items.flatMap((item) => {
        const from = previousStepId(run.definition, item.data.path);
        const output = from ? item.data.outputs?.[from] : undefined;
        if (!output || (output as { batchLeader?: boolean }).batchLeader === false) return [];
        const { batchLeader: _leader, ...answer } = output as Record<string, unknown>;
        return [pickPaths(answer, fields)];
      });
      // Items that ended failed on the way here: a condition after the gather can stop on them.
      const failed = tx.select({ count: count() }).from(s.runItems).where(and(eq(s.runItems.runId, run.id), eq(s.runItems.state, 'failed'), inArray(s.runItems.nodeId, before.length ? before : ['']))).get()!.count;
      const [carrier, ...rest] = items;
      if (!carrier) return;
      for (const item of rest)
        tx.update(s.runItems).set({ state: 'done', data: { ...item.data, path: [...item.data.path, { nodeId: gather.id, port: 'gathered', at: Date.now() }].slice(-200) } }).where(eq(s.runItems.id, item.id)).run();
      record(tx, run, carrier, { port: 'out', output: { parts, count: parts.length, failed, batchLeader: true } });
    });
    closed = true;
  }
  return closed;
}
