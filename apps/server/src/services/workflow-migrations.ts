import { and, count, eq, isNull, notInArray, or } from 'drizzle-orm';
import {
  ANALYSIS_WORKFLOW,
  ANALYSIS_WORKFLOW_DESCRIPTION,
  ANALYSIS_WORKFLOW_PRESETS,
  analysisTemplate,
  analysisWorkflowTemplate,
  draftTranslationTemplate,
  listenerTemplate,
  syncEntryEdges,
  termExtractionTemplate,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { defaultModelChoice } from './routes.ts';
import { discoverAndSave } from './terms.ts';

type FunctionNode = Extract<WorkflowNode, { type: 'function' }>;

const idOf = () => `e-${crypto.randomUUID().slice(0, 8)}`;

const AUTO_SAVE_FNS = new Set(['addTerms', 'setListener', 'applyKnowledge', 'saveAnalysis']);

/**
 * #42: translations are written when a node produces them, so the status-change node no longer
 * applies a candidate. This drops `applyCandidate` from every setStatus node; a node that only
 * applied a candidate (no status, no tags) is removed and its incoming and outgoing edges are bridged,
 * and the default template's 'confirm' node is relabelled '확정으로'. Returns null when the
 * definition already satisfies this, so callers can skip a write and stay idempotent.
 */
export function stripApplyCandidate(definition: WorkflowDefinition): WorkflowDefinition | null {
  let changed = false;
  const removed = new Set<string>();
  const nodes: WorkflowNode[] = [];
  for (const node of definition.nodes) {
    if (node.type !== 'function' || node.config.fn !== 'setStatus') {
      nodes.push(node);
      continue;
    }
    const params = { ...node.config.params };
    const applied = params.applyCandidate === true;
    if ('applyCandidate' in params) {
      delete params.applyCandidate;
      changed = true;
    }
    const statusId = params.statusId as string | undefined;
    const add = (params.addTagIds as string[] | undefined) ?? [];
    const remove = (params.removeTagIds as string[] | undefined) ?? [];
    if (applied && !statusId && !add.length && !remove.length) {
      // A node that only applied a candidate (the default '번역에 적용') is now a no-op. One the
      // person left empty on purpose without that switch is theirs to keep.
      removed.add(node.id);
      changed = true;
      continue;
    }
    let next: FunctionNode = { ...node, config: { ...node.config, params } };
    if (next.id === 'confirm' && next.label === '확정') {
      next = { ...next, label: '확정으로' };
      changed = true;
    }
    nodes.push(next);
  }
  if (!changed) return null;

  // Bridge around every removed node through any chain of removed nodes, keeping the endpoints' handles.
  const incoming = (id: string) => definition.edges.filter((edge) => edge.target === id);
  const outgoing = (id: string) => definition.edges.filter((edge) => edge.source === id);
  const predecessors = (id: string, seen = new Set<string>()): WorkflowEdge[] =>
    incoming(id).flatMap((edge) => (removed.has(edge.source) ? (seen.has(edge.source) ? [] : (seen.add(edge.source), predecessors(edge.source, seen))) : [edge]));
  const successors = (id: string, seen = new Set<string>()): WorkflowEdge[] =>
    outgoing(id).flatMap((edge) => (removed.has(edge.target) ? (seen.has(edge.target) ? [] : (seen.add(edge.target), successors(edge.target, seen))) : [edge]));
  const edges: WorkflowEdge[] = definition.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
  const seen = new Set(edges.map((edge) => `${edge.source}|${edge.sourceHandle}|${edge.target}`));
  for (const id of removed)
    for (const before of predecessors(id))
      for (const after of successors(id)) {
        const key = `${before.source}|${before.sourceHandle}|${after.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ id: idOf(), source: before.source, sourceHandle: before.sourceHandle, target: after.target });
      }
  return { ...definition, nodes, edges };
}

/** Applies stripApplyCandidate to every saved workflow, bumping its version only where it changed. */
export function migrateApplyCandidate(db: Db): number {
  let changed = 0;
  for (const row of db.select().from(s.workflows).all()) {
    const next = stripApplyCandidate(row.definition);
    if (!next) continue;
    db.update(s.workflows).set({ definition: next, version: row.version + 1 }).where(eq(s.workflows.id, row.id)).run();
    changed++;
  }
  return changed;
}

/** Upgrades legacy default extraction workflows and seeds missing default workflows on existing projects. */
export function migrateDefaultWorkflows(db: Db): number {
  let changed = 0;
  for (const row of db.select().from(s.workflows).all()) {
    const hasEndOrSave = row.definition.nodes.some(
      (n) => n.type === 'end' || (n.type === 'function' && AUTO_SAVE_FNS.has(n.config.fn)),
    );
    if (!hasEndOrSave) continue;
    const nodes = row.definition.nodes.filter(
      (n) => n.type !== 'end' && !(n.type === 'function' && AUTO_SAVE_FNS.has(n.config.fn)),
    );
    const keepIds = new Set(nodes.map((n) => n.id));
    const edges = row.definition.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target));
    const next = syncEntryEdges({ ...row.definition, nodes, edges });
    db.update(s.workflows).set({ definition: next, version: row.version + 1 }).where(eq(s.workflows.id, row.id)).run();
    changed++;
  }
  const model = defaultModelChoice(db);
  for (const project of db.select({ id: s.projects.id }).from(s.projects).all()) {
    const existingNames = new Set(
      db.select({ name: s.workflows.name }).from(s.workflows).where(eq(s.workflows.projectId, project.id)).all().map((w) => w.name),
    );
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, project.id)).all();
    const initial = statuses.find((st) => st.kind === 'initial') ?? statuses[0];
    const draft = statuses.find((st) => st.name === '초벌') ?? statuses.find((st) => st.kind === 'normal') ?? statuses.find((st) => st.kind === 'final') ?? initial;
    if (initial && draft && !existingNames.has('초벌 번역')) {
      db.insert(s.workflows)
        .values({
          projectId: project.id,
          name: '초벌 번역',
          description: '미번역 대사를 AI로 번역하고 형식을 검사해 초벌 상태로 바꿉니다.',
          definition: draftTranslationTemplate({ model, untranslated: initial.id, draft: draft.id }),
        })
        .run();
      changed++;
    }
    if (!existingNames.has('청자 추정')) {
      db.insert(s.workflows)
        .values({
          projectId: project.id,
          name: '청자 추정',
          description: '청자가 아직 없는 대사만 장면별로 누구에게 하는 말인지 추정해 적습니다. 번역·상태는 바꾸지 않습니다.',
          definition: listenerTemplate({ model }),
        })
        .run();
      changed++;
    }
    if (!existingNames.has('용어 추출')) {
      db.insert(s.workflows)
        .values({
          projectId: project.id,
          name: '용어 추출',
          description: '장면별로 고유명사·반복 용어를 뽑아 용어집 후보로 추가합니다.',
          definition: termExtractionTemplate({ model }),
        })
        .run();
      changed++;
    }
    if (!existingNames.has('인물·관계 추출')) {
      db.insert(s.workflows)
        .values({
          projectId: project.id,
          name: '인물·관계 추출',
          description: ANALYSIS_WORKFLOW_PRESETS.peopleRelations.description,
          definition: analysisWorkflowTemplate({ model, presetId: 'peopleRelations' }),
        })
        .run();
      changed++;
    }
    if (!existingNames.has('사건 추출')) {
      db.insert(s.workflows)
        .values({
          projectId: project.id,
          name: '사건 추출',
          description: ANALYSIS_WORKFLOW_PRESETS.events.description,
          definition: analysisWorkflowTemplate({ model, presetId: 'events' }),
        })
        .run();
      changed++;
    }
    if (!existingNames.has(ANALYSIS_WORKFLOW)) {
      db.insert(s.workflows)
        .values({
          projectId: project.id,
          name: ANALYSIS_WORKFLOW,
          description: ANALYSIS_WORKFLOW_DESCRIPTION,
          definition: analysisTemplate({ model }),
        })
        .run();
      changed++;
    }

    const candidateScriptTermCount = db
      .select({ count: count() })
      .from(s.terms)
      .where(
        and(
          eq(s.terms.projectId, project.id),
          eq(s.terms.origin, 'script'),
          eq(s.terms.status, 'candidate'),
        ),
      )
      .get()?.count ?? 0;

    if (candidateScriptTermCount > 500) {
      db.delete(s.terms)
        .where(
          and(
            eq(s.terms.projectId, project.id),
            eq(s.terms.origin, 'script'),
            eq(s.terms.status, 'candidate'),
            or(eq(s.terms.target, ''), isNull(s.terms.target)),
            notInArray(
              s.terms.id,
              db.select({ itemId: s.knowledgeTags.itemId }).from(s.knowledgeTags).where(eq(s.knowledgeTags.kind, 'terms')),
            ),
          ),
        )
        .run();
      discoverAndSave(db, project.id);
    }
  }
  return changed;
}

