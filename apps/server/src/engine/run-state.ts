import { eq } from 'drizzle-orm';
import { choiceKey, exitActions, nodeRetries, pickPaths, previousStepId, retryModel, retryRuleIndex, runNodeName, type AiNode, type ItemErrorKind, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemData, ItemState } from '../db/schema.ts';
import type { Outcome } from './ai-output.ts';
import { applyExitActions } from './exit-actions.ts';
import { subjectOf } from './subjects.ts';

export type Run = typeof s.runs.$inferSelect;
export type Item = typeof s.runItems.$inferSelect;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/*
 * The state machine of one run item: what a node's outcome does to it (record), which node it goes to
 * next (route), and when an AI node's retry rule takes a failed line back instead (retryRule). Pure
 * database steps inside the caller's transaction: nothing here schedules, calls a model or notifies.
 */

export const nodeOf = (run: Run, nodeId: string): WorkflowNode | undefined => run.definition.nodes.find((node) => node.id === nodeId);

/**
 * The result of the step before `node` on the item's way here (input.previous), trimmed to input.fields:
 * the last node it passed that leaves a result (leavesResult), not through that node's error exit.
 * Undefined when there is none, or when that step answered for a whole batch and the answer rides on
 * another item (only a batch's first item carries it).
 */
export function previousOf(item: Item, definition: WorkflowDefinition, node: AiNode) {
  const input = node.config.input;
  if (!input.previous) return undefined;
  const step = previousStepId(definition, item.data.path);
  if (!step) return undefined;
  const { batchLeader, ...output } = item.data.outputs?.[step] ?? { batchLeader: false };
  return batchLeader === false ? undefined : pickPaths(output, input.fields);
}

/**
 * The rule of an AI node that sends `item` back after a failure of `kind`, with its index (the key its times are
 * counted under is `node:index`), or undefined when none does: the line leaves through 오류.
 */
export function retryRule(run: Run, node: WorkflowNode | undefined, item: Item, kind: ItemErrorKind) {
  if (node?.type !== 'ai') return undefined;
  const rules = nodeRetries(run.definition, node);
  const index = retryRuleIndex(rules, kind, (at) => item.data.retry?.times[`${node.id}:${at}`] ?? 0);
  return index < 0 ? undefined : { rule: rules[index]!, key: `${node.id}:${index}` };
}

/** Whether every one of these lines (as they were before this failure) is sent back by `nodeId`'s retry rules for a failure of `kind`. */
export function takenBack(run: Run, nodeId: string, batch: Item[], kind: ItemErrorKind) {
  const node = nodeOf(run, nodeId);
  return batch.every((item) => retryRule(run, node, item, kind) !== undefined);
}

/** Store what a node produced for a line, then move the line out through the chosen exit. */
export function record(tx: Tx, run: Run, item: Item, outcome: Outcome) {
  const data: ItemData = { ...item.data, outputs: { ...item.data.outputs } };
  if (outcome.output) data.outputs![item.nodeId] = outcome.output;
  // A returned "text" is the line's working text (an HTTP call or a script that rewrites it), like an AI translation.
  const returned = (outcome.output as { text?: unknown } | undefined)?.text;
  if (outcome.candidate === undefined && typeof returned === 'string' && returned !== item.data.candidateText) outcome = { ...outcome, candidate: returned };
  if (outcome.candidate !== undefined) {
    // The run's working text only; the line itself changes in an apply node ("번역 저장").
    data.textBefore = item.data.candidateText;
    data.candidateText = outcome.candidate;
    data.issues = []; // a new text answers the previous issues
  }
  if (outcome.issues?.length) data.issues = outcome.issues;
  route(tx, run, { ...item, data }, outcome.port, outcome.error, outcome.errorKind);
}

/**
 * Moves an item out through `port`. An exit with no edge ends the item (failed while it carries a failure). An
 * exit with several edges sends the line down each of them: the item takes the first, and a copy
 * of it each of the others (validation keeps those branches apart until they end).
 */
export function route(tx: Tx, run: Run, item: Item, port: string, error?: string, kind?: ItemErrorKind) {
  const definition: WorkflowDefinition = run.definition;
  // What conditions read as error: set by an "error" exit (a node without its own kind keeps the
  // failure it was sent with), kept through conditions (they only route the
  // line), cleared once a working node handles it.
  const previous = item.data.error;
  const routing = nodeOf(run, item.nodeId)?.type === 'condition';
  let failure =
    port === 'error' ? (kind || !previous ? { kind: kind ?? 'other', message: error ?? '', nodeId: item.nodeId } : { ...previous, message: error || previous.message }) : routing ? previous : undefined;
  item = { ...item, data: { ...item.data, error: failure, ...(port === 'error' && failure && { lastError: failure }) } };
  // A failed line an AI node's retry rule takes goes to the same node again, without a visit: in smaller requests,
  // after a wait, on another model, as the rule says. Anything else leaves through the 오류 exit.
  const resend = port === 'error' && failure ? retryRule(run, nodeOf(run, item.nodeId), item, failure.kind) : undefined;
  if (resend) {
    const { rule, key } = resend;
    const picked = retryModel(rule);
    const retry: NonNullable<ItemData['retry']> = {
      times: { ...item.data.retry?.times, [key]: (item.data.retry?.times[key] ?? 0) + 1 },
      factor: (item.data.retry?.factor ?? 1) * rule.scale,
      last: { kind: failure!.kind, message: failure!.message, nodeId: item.nodeId, rule: Number(key.slice(key.lastIndexOf(':') + 1)), ...(rule.wait > 0 && { waitSeconds: rule.wait }) },
      ...(picked && { model: { nodeId: item.nodeId, key: choiceKey(picked) } }),
    };
    const path = [...item.data.path, { nodeId: item.nodeId, port: 'retry', at: Date.now() }].slice(-200);
    tx.update(s.runItems)
      .set({ state: 'queued', error: null, data: { ...item.data, error: undefined, retry, path }, notBefore: rule.wait > 0 ? new Date(Date.now() + rule.wait * 1000) : null })
      .where(eq(s.runItems.id, item.id))
      .run();
    return;
  }
  const edges = definition.edges.filter((candidate) => candidate.source === item.nodeId && candidate.sourceHandle === port);
  const path = [...item.data.path, { nodeId: item.nodeId, port, at: Date.now() }].slice(-200);
  // 출구 동작: the exit marks the line (tags, status) once, before its lines split. A status it sets (검토 필요) is a
  // decision about the failure the exit carried, as is a line going on to another node: the line is no longer
  // failed. Tags alone only mark it: a line that ends there still ends failed (counted as failed, offered again by
  // '실패한 줄 다시'). If an action cannot be done (the database refuses), the line fails here; it is not sent out the
  // 오류 exit, whose actions could fail the same way.
  const actions = exitActions(nodeOf(run, item.nodeId), port);
  if (actions.length) {
    try {
      const notes = applyExitActions(tx, run, item, item.nodeId, port, actions, subjectOf(run.subject).exitActions);
      if (notes.length) item = { ...item, data: { ...item.data, exitNotes: [...(item.data.exitNotes ?? []), ...notes.map((note) => ({ at: `${item.nodeId}:${port}`, note }))].slice(-50) } };
    } catch (cause) {
      const node = nodeOf(run, item.nodeId);
      const message = `'${node ? runNodeName(definition, node) : item.nodeId}'의 출구 동작을 하지 못했습니다: ${cause instanceof Error ? cause.message : String(cause)}`;
      tx.update(s.runItems).set({ state: 'failed', error: message, data: { ...item.data, path }, notBefore: null }).where(eq(s.runItems.id, item.id)).run();
      return;
    }
    if (edges.length || actions.some((action) => action.type === 'status')) {
      failure = undefined;
      error = undefined;
      item = { ...item, data: { ...item.data, error: undefined } };
    }
  }
  const moved = (target: string | undefined) => {
    let state: ItemState = 'queued';
    let nodeId = item.nodeId;
    let message = failure?.message || error || null;
    const visits = { ...item.visits };
    if (!target) {
      // An exit with nothing after it ends the line: failed when it still carries a failure (an
      // "error" exit, or a condition it reached from one), else done.
      state = failure ? 'failed' : 'done';
    } else {
      nodeId = target;
      visits[nodeId] = (visits[nodeId] ?? 0) + 1;
      if (visits[nodeId] > definition.settings.maxVisitsPerNode) {
        const node = nodeOf(run, nodeId);
        state = 'failed';
        message = `'${node ? runNodeName(definition, node) : nodeId}' 노드 방문 상한(${definition.settings.maxVisitsPerNode}회)을 넘었습니다.`;
      }
    }
    return { nodeId, state, visits, data: { ...item.data, path }, error: message, notBefore: null };
  };
  tx.update(s.runItems).set(moved(edges[0]?.target)).where(eq(s.runItems.id, item.id)).run();
  for (const edge of edges.slice(1)) tx.insert(s.runItems).values({ runId: run.id, subjectId: item.subjectId, plan: item.plan, ...moved(edge.target) }).run();
}
