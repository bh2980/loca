import { and, count, eq, isNull, notInArray, or } from 'drizzle-orm';
import {
  AI_OUTPUT_IDS,
  analysisTemplate,
  ANALYSIS_WORKFLOW,
  defaultWorkflows,
  eventExtractionTemplate,
  listenerTemplate,
  peopleRelationsTemplate,
  speechFixTemplate,
  SPEECH_FIX_WORKFLOW,
  termExtractionTemplate,
  type WorkflowDefinition,
} from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { defaultModelChoice } from './routes.ts';
import { discoverAndSave } from './terms.ts';

/** Functions of the nodes that hid their saving (before 반영 nodes): a workflow still using one is of the old shape. */
const LEGACY_FUNCTIONS = new Set(['addTerms', 'applyKnowledge', 'saveAnalysis']);

/**
 * A definition of an old shape: an AI node whose output is a purpose (candidate, terms, knowledge,
 * analysis, listener) or a node that saves in hiding (before the general outputs and 반영 nodes); a
 * condition reading the removed `listenerKnown`; a 청자 추정 node still answering as a choice (before
 * it answered JSON with "unknown"). The stored JSON is not validated on read, so this looks at it as it is.
 */
export function isLegacyDefinition(definition: WorkflowDefinition): boolean {
  return definition.nodes.some(
    (node) =>
      (node.type === 'ai' && (!AI_OUTPUT_IDS.includes(node.config.output) || (node.config.preset === 'listener' && node.config.output === 'choice'))) ||
      (node.type === 'function' && LEGACY_FUNCTIONS.has(node.config.fn)) ||
      (node.type === 'condition' && JSON.stringify(node.config.expression ?? null).includes('"listenerKnown"')),
  );
}

/**
 * Replaces the built-in workflows of existing projects, found by their default names, with the current
 * definitions when they are still of the old shape. The model each had is kept. No field-by-field
 * conversion: a workflow a person made (or renamed) with old outputs is left alone and shows validation
 * errors until they rebuild it. Once replaced a workflow is no longer of the old shape, so this runs
 * once; a built-in a person deleted is not brought back.
 */
export function replaceLegacyBuiltins(db: Db): number {
  let replaced = 0;
  const fallback = defaultModelChoice(db);
  for (const row of db.select().from(s.workflows).all()) {
    if (!isLegacyDefinition(row.definition)) continue;
    const picked = row.definition.nodes.find((node) => node.type === 'ai' && node.config.model?.model);
    const model = picked?.type === 'ai' ? picked.config.model : fallback;
    let next: WorkflowDefinition | undefined;
    if (row.name === '초벌 번역') {
      const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, row.projectId)).all();
      const initial = statuses.find((status) => status.kind === 'initial') ?? statuses[0];
      const draft = statuses.find((status) => status.name === '초벌') ?? statuses.find((status) => status.kind === 'normal') ?? statuses.find((status) => status.kind === 'final') ?? initial;
      if (initial && draft) next = defaultWorkflows({ model, untranslated: initial.id, draft: draft.id }).find((workflow) => workflow.name === row.name)?.definition;
    } else
      next = ({
        '청자 추정': listenerTemplate,
        '용어 추출': termExtractionTemplate,
        '인물·관계 추출': peopleRelationsTemplate,
        '사건 추출': eventExtractionTemplate,
        [ANALYSIS_WORKFLOW]: analysisTemplate,
        [SPEECH_FIX_WORKFLOW]: speechFixTemplate,
      } as Record<string, ((ids: { model: typeof model }) => WorkflowDefinition) | undefined>)[row.name]?.({ model });
    if (!next) continue;
    db.update(s.workflows).set({ definition: next, version: row.version + 1 }).where(eq(s.workflows.id, row.id)).run();
    replaced++;
  }
  return replaced;
}

/** Projects with a flood of script-found term candidates (more than 500) keep only the ones with a translation or tags, then are searched again. */
export function trimScriptTermCandidates(db: Db): void {
  for (const project of db.select({ id: s.projects.id }).from(s.projects).all()) {
    const candidateScriptTermCount =
      db
        .select({ count: count() })
        .from(s.terms)
        .where(and(eq(s.terms.projectId, project.id), eq(s.terms.origin, 'script'), eq(s.terms.status, 'candidate')))
        .get()?.count ?? 0;
    if (candidateScriptTermCount <= 500) continue;
    db.delete(s.terms)
      .where(
        and(
          eq(s.terms.projectId, project.id),
          eq(s.terms.origin, 'script'),
          eq(s.terms.status, 'candidate'),
          or(eq(s.terms.target, ''), isNull(s.terms.target)),
          notInArray(s.terms.id, db.select({ itemId: s.knowledgeTags.itemId }).from(s.knowledgeTags).where(eq(s.knowledgeTags.kind, 'terms'))),
        ),
      )
      .run();
    discoverAndSave(db, project.id);
  }
}

/**
 * AI nodes take their request sizes from their connection (입력·출력 토큰, or the model's own limits):
 * budgets saved on a node (the old fixed defaults, or numbers from when nodes had these fields) are cleared.
 */
export function autoBudgetDefaults(db: Db): number {
  let changed = 0;
  for (const workflow of db.select({ id: s.workflows.id, definition: s.workflows.definition }).from(s.workflows).all()) {
    let touched = false;
    const nodes = workflow.definition.nodes.map((node) => {
      if (node.type !== 'ai') return node;
      const batch = node.config.batch as { mode?: string; maxTokens?: number | null } | undefined;
      const context = node.config.context as { maxTokens?: number | null } | undefined;
      const oldBatch = typeof batch?.maxTokens === 'number';
      const oldContext = typeof context?.maxTokens === 'number';
      if (!oldBatch && !oldContext) return node;
      touched = true;
      return { ...node, config: { ...node.config, ...(oldBatch && { batch: { ...node.config.batch, maxTokens: null } }), ...(oldContext && { context: { ...node.config.context, maxTokens: null } }) } };
    });
    if (!touched) continue;
    db.update(s.workflows).set({ definition: { ...workflow.definition, nodes } as WorkflowDefinition }).where(eq(s.workflows.id, workflow.id)).run();
    changed++;
  }
  return changed;
}
