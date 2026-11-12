import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import jsonLogic from 'json-logic-js';
import { INPUT_TYPES, byNodeType, functionTakes, pickPaths, previousStepId, runNodeName, type ConditionData, type WorkflowNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { Topic } from '../events.ts';
import { APPLY_TOPICS } from './functions/apply.ts';
import { runInstantFunction, type FunctionInput } from './functions/index.ts';
import { nodeOf, record, route, type Item, type Run, type Tx } from './run-state.ts';
import { subjectOf } from './subjects.ts';

export type GatherNode = Extract<WorkflowNode, { type: 'gather' }>;

/*
 * The nodes of a run that finish at once, inside a transaction: entry, conditions, functions that do not
 * wait for anything, and a gather closing. The scheduler hands them items; they record and route.
 */

/** Functions that write beyond the line itself, and the change topic they touch. */
const FUNCTION_TOPICS: Record<string, Topic[]> = { ...APPLY_TOPICS };

/** Why a node of the other input sends an item out through "error" (validation keeps such nodes out; a safety net). */
const unsupported = (run: Run, node: WorkflowNode) => `'${runNodeName(run.definition, node)}' 노드는 ${INPUT_TYPES[run.subject].label}에 쓸 수 없어 오류 출구로 보냈습니다.`;

/** Runs instant nodes for `items` until `deadline` (the rest stay queued for the next tick); returns the extra topics their functions wrote to. */
export function settle(db: Db, run: Run, items: Item[], deadline: number): Set<Topic> {
  const subject = subjectOf(run.subject);
  const topics = new Set<Topic>();
  for (const item of items) {
    const node = nodeOf(run, item.nodeId);
    for (const topic of node?.type === 'function' ? (FUNCTION_TOPICS[node.config.fn] ?? []) : []) topics.add(topic);
    if (Object.keys(node?.exits ?? {}).length) for (const topic of subject.exitTopics) topics.add(topic);
  }
  db.transaction((tx) => {
    const inputOf = subject.inputs(tx, run, items);
    for (const item of items) {
      const node = nodeOf(run, item.nodeId);
      const input = inputOf(item);
      if (!node || !input) {
        tx.update(s.runItems).set({ state: 'failed', error: `노드 또는 ${subject.gone}` }).where(eq(s.runItems.id, item.id)).run();
        continue;
      }
      runInstant(tx, run, node, item, input);
      if (performance.now() >= deadline) return;
    }
  });
  return topics;
}

/** What each kind of node does with an item that reaches it inside the instant pass. A node that calls out never gets here: the scheduler dispatches it. */
function runInstant(tx: Tx, run: Run, node: WorkflowNode, item: Item, input: FunctionInput) {
  const notInstant = () => route(tx, run, item, 'error', '즉시 실행할 수 없는 노드입니다.');
  return byNodeType(node, {
    entry: () => route(tx, run, item, 'out'),
    condition: (condition) => {
      const data: ConditionData = { visits: item.visits, outputs: item.data.outputs ?? {}, issues: item.data.issues ?? [], error: item.data.error ?? null, ...subjectOf(run.subject).condition(tx, run, condition, input) };
      try {
        return route(tx, run, item, jsonLogic.apply(condition.config.expression as jsonLogic.RulesLogic, data) ? 'true' : 'false');
      } catch (error) {
        return route(tx, run, item, 'error', `조건식 오류: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    function: ({ config }) => {
      if (!functionTakes(config.fn, run.subject)) return route(tx, run, item, 'error', unsupported(run, node), 'unsupported');
      // Like an async function's input: the result of the step before it on the item's way here.
      const previousStep = previousStepId(run.definition, item.data.path);
      try {
        return record(tx, run, item, runInstantFunction(tx, config, previousStep ? { ...input, previous: item.data.outputs?.[previousStep] as Record<string, unknown> | undefined } : input));
      } catch (error) {
        return route(tx, run, item, 'error', error instanceof Error ? error.message : String(error));
      }
    },
    ai: notInstant,
    // A gather closes when its upstream is done (closeGathers), and a call was replaced by its workflow's nodes when the run started.
    gather: notInstant,
    call: notInstant,
  });
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
