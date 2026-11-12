import { and, asc, eq, inArray } from 'drizzle-orm';
import { estimateTokens, nodeName, workflowInput, type AiNode, bySubject, type Subject } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { expandedDefinition } from '../engine/expand-calls.ts';
import { buildRequest, readsPrevious, type BuiltRequest } from '../engine/request.ts';
import { batchOf } from '../engine/run-create.ts';
import { subjectOf } from '../engine/subjects.ts';
import { resolveBudgets } from './budgets.ts';
import { translatableSql } from './line-marks.ts';

type Workflow = typeof s.workflows.$inferSelect;

/** Items of the request listed before "외 N개". */
const SHOWN = 5;

/** Why a node's request cannot be shown outside a run. Said as it is: nothing is built to look like it. */
const UNAVAILABLE = {
  previous: '이 노드는 앞 노드의 결과를 읽습니다. 보낼 내용은 실행 중에 앞 노드가 답해야 정해지므로 여기서는 만들 수 없습니다. 실제로 보낸 내용은 실행 기록의 호출에서 볼 수 있습니다.',
  excludedLine: '번역 제외 대사라 실행에 들어가지 않습니다. 이 대사로는 요청을 보내지 않습니다.',
  excludedTerm: '실행에 들어가지 않는 용어입니다(제외한 용어). 이 용어로는 요청을 보내지 않습니다.',
};

/**
 * The request a run of the whole script would send `subjectId` (a line or a term) in at a saved AI node,
 * without calling a model: the run's own batch for it (batchOf) and the run's own request builder
 * (buildRequest), on the definition as a run stores it (calls expanded, "auto" budgets fixed). Lines show
 * what is stored for them now; a run sends its working text, which for the first AI node is the same.
 * `unavailable` says why there is nothing to show: the node reads an earlier node's result, or a run
 * does not take the item.
 */
function nodeRequest(db: Db, workflow: Workflow, nodeId: string, subjectId: string): { unavailable: string } | { node: AiNode; ids: string[]; built: BuiltRequest } | null {
  let definition: Workflow['definition'];
  try {
    definition = resolveBudgets(db, expandedDefinition(db, workflow.projectId, workflow.definition, workflow.id));
  } catch (error) {
    // A workflow it calls cannot be put in place: a run would not start either, for the same reason.
    return { unavailable: error instanceof Error ? error.message : String(error) };
  }
  const node = definition.nodes.find((candidate): candidate is AiNode => candidate.id === nodeId && candidate.type === 'ai');
  if (!node) return null;
  if (readsPrevious(node)) return { unavailable: UNAVAILABLE.previous };
  const subject = workflowInput(definition);
  const ids = batchOf(db, workflow.projectId, definition, node, subjectId);
  if (!ids) return { unavailable: bySubject(subject, { terms: UNAVAILABLE.excludedTerm, lines: UNAVAILABLE.excludedLine }) };
  return { node, ids, built: buildRequest(db, workflow.projectId, node, subject, ids.map((id) => ({ id }))) };
}

/**
 * 보낼 내용: one request of a saved AI node — the request that holds `sample` (a line key, or a term id),
 * else the first item a run would take. The editor shows its size, instructions, answer form, context
 * by kind and its first items; the full text is there too. `unavailable`: why there is no request to show.
 */
export function previewRequest(db: Db, workflow: Workflow, nodeId: string, sample?: string) {
  const own = workflow.definition.nodes.find((candidate): candidate is AiNode => candidate.id === nodeId && candidate.type === 'ai');
  if (!own) return null;
  const subject = workflowInput(workflow.definition);
  const projectId = workflow.projectId;
  const base = { subject, instructions: own.config.instructions, output: own.config.output, fields: own.config.fields };
  const nothing = { ...base, sample: null, total: 0, items: [], context: [], system: '', prompt: '', promptTokens: 0, unavailable: null as string | null };

  const picked = SAMPLES[subject].find(db, projectId, sample);
  if (!picked) return nothing;
  const chosen = { value: picked.value, label: picked.label };
  const request = nodeRequest(db, workflow, nodeId, picked.id);
  if (!request) return null;
  if ('unavailable' in request) return { ...nothing, sample: chosen, unavailable: request.unavailable };
  return { ...base, sample: chosen, total: request.ids.length, items: SAMPLES[subject].items(db, request.ids.slice(0, SHOWN)), ...shown(request.built) };
}

/**
 * How a preview finds its sample item (the one asked for, else the first a run would take) and lists a request's
 * first items, per input: a line by its key, shown as "speaker: source"; a term by its id, shown with its Korean form.
 */
const SAMPLES: Record<Subject, { find: (db: Db, projectId: string, sample?: string) => { id: string; value: string; label: string } | undefined; items: (db: Db, ids: string[]) => { label: string; text: string }[] }> = {
  lines: {
    find(db, projectId, sample) {
      const unit = sample
        ? db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, sample))).get()
        : db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), translatableSql(projectId))).orderBy(asc(s.units.seq)).limit(1).get();
      return unit && { id: unit.id, value: unit.key, label: unit.key };
    },
    items(db, ids) {
      const rows = new Map(db.select({ id: s.units.id, key: s.units.key, speaker: s.units.speaker, source: s.units.source }).from(s.units).where(inArray(s.units.id, ids)).all().map((row) => [row.id, row]));
      return ids.map((id) => ({ label: rows.get(id)?.key ?? id, text: `${rows.get(id)?.speaker ? `${rows.get(id)!.speaker}: ` : ''}${rows.get(id)?.source ?? ''}` }));
    },
  },
  terms: {
    find(db, projectId, sample) {
      const termId = sample ?? subjectOf('terms').select(db, projectId, {})[0];
      const term = termId ? db.select({ id: s.terms.id, source: s.terms.source }).from(s.terms).where(and(eq(s.terms.projectId, projectId), eq(s.terms.id, termId))).get() : undefined;
      return term && { id: term.id, value: term.id, label: term.source };
    },
    items(db, ids) {
      const terms = new Map(db.select({ id: s.terms.id, source: s.terms.source, target: s.terms.target }).from(s.terms).where(inArray(s.terms.id, ids)).all().map((row) => [row.id, row]));
      return ids.map((id) => ({ label: terms.get(id)?.source ?? id, text: terms.get(id)?.target || '—' }));
    },
  },
};

const shown = (built: BuiltRequest) => ({ context: built.context.items, system: built.system, prompt: built.prompt, promptTokens: estimateTokens(`${built.system}\n\n${built.prompt}`), unavailable: null as string | null });

/**
 * `loca context`: what an AI node of a lines workflow would send for a line — the same request as
 * previewRequest, with the line's own preceding lines and the context budget apart. `pick` names the
 * node; without one, the first node that writes a translation.
 */
export function previewContext(db: Db, projectId: string, unitKey: string, pick: { workflowId?: string; nodeId?: string }) {
  const unit = db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, unitKey))).get();
  if (!unit) return null;
  const workflows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).orderBy(asc(s.workflows.name)).all().filter((workflow) => workflowInput(workflow.definition) === 'lines');
  const choices = workflows.flatMap((workflow) =>
    workflow.definition.nodes.filter((node): node is AiNode => node.type === 'ai').map((node) => ({ workflowId: workflow.id, workflowName: workflow.name, nodeId: node.id, nodeName: nodeName(node), output: node.config.output })),
  );
  const picked = choices.find((choice) => (!pick.workflowId || choice.workflowId === pick.workflowId) && choice.nodeId === pick.nodeId) ?? choices.find((choice) => choice.output === 'text') ?? choices[0];
  if (!picked) return { unitKey, choices, picked: null };
  const chosen = { unitKey, choices, picked: { workflowId: picked.workflowId, nodeId: picked.nodeId } };
  const request = nodeRequest(db, workflows.find((workflow) => workflow.id === picked.workflowId)!, picked.nodeId, unit.id);
  if (!request) return { unitKey, choices, picked: null };
  if ('unavailable' in request) return { ...chosen, unavailable: request.unavailable };
  const { node, ids, built } = request;
  const keys = new Map(db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(inArray(s.units.id, ids)).all().map((row) => [row.id, row.key]));
  return {
    ...chosen,
    batch: { mode: node.config.batch.mode, size: node.config.batch.size, keys: ids.map((id) => keys.get(id)!) },
    precedingLines: node.config.context.precedingLines,
    /** This line's own preceding lines; empty when the lines before it are in the batch or shown for an earlier line. */
    preceding: built.context.preceding[unit.id] ?? null,
    items: built.context.items,
    budget: built.context.budget,
    system: built.system,
    prompt: built.prompt,
    promptTokens: estimateTokens(`${built.system}\n\n${built.prompt}`),
  };
}
