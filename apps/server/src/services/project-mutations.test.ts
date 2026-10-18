import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema, translationTemplate } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { createStatus, deleteStatus, TaxonomyMutationError, updateStatus } from './project-taxonomy.ts';
import { deleteWorkflow, saveWorkflow, WorkflowMutationError } from './workflow-mutations.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1', project: { name: 'Mutation test' },
    groups: [{ key: 'scene', title: 'Scene' }],
    units: [{ key: 'scene.1', group: 'scene', source: 'Hello' }],
  }), null as never);
  const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
  const initial = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'initial'))).get()!;
  const final = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'final'))).get()!;
  return { db, projectId, unit, initial, final };
}

describe('shared project mutations', () => {
  it('prevents status edits or moves from placing blank lines in final', () => {
    const { db, projectId, unit, initial, final } = setup();
    createStatus(db, projectId, { name: 'Second initial', kind: 'initial' });

    expect(() => updateStatus(db, projectId, initial.id, { kind: 'final' })).toThrow(TaxonomyMutationError);
    expect(() => deleteStatus(db, projectId, initial.id, final.id)).toThrow(TaxonomyMutationError);
    expect(db.select().from(s.statuses).where(eq(s.statuses.id, initial.id)).get()).toBeDefined();
    expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()?.statusId).toBe(initial.id);

    db.update(s.units).set({ translation: '번역' }).where(eq(s.units.id, unit.id)).run();
    expect(updateStatus(db, projectId, initial.id, { kind: 'final' }).kind).toBe('final');
  });

  it('keeps at least one initial and one final status', () => {
    const { db, projectId, initial, final } = setup();
    const normal = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'normal'))).get()!;
    expect(() => deleteStatus(db, projectId, initial.id, normal.id)).toThrow('처음 상태는 하나 이상 있어야 합니다.');
    expect(() => updateStatus(db, projectId, final.id, { kind: 'normal' })).toThrow('완료 상태는 하나 이상 있어야 합니다.');
  });

  it('blocks workflow edits and deletion while a run is paused, then allows them after completion', () => {
    const { db, projectId } = setup();
    const definition = translationTemplate({ model: { connectionId: '', model: '' }, untranslated: 'start', draft: 'draft', needsReview: 'review', confirmed: 'done' });
    const workflow = saveWorkflow(db, projectId, { name: 'W', description: '', definition });
    db.insert(s.runs).values({
      projectId, workflowId: workflow.id, workflowName: workflow.name, workflowVersion: workflow.version,
      definition: workflow.definition, scope: {}, status: 'paused', total: 1,
    }).run();

    expect(() => saveWorkflow(db, projectId, { id: workflow.id, name: 'W2', description: '', definition })).toThrow(WorkflowMutationError);
    expect(() => deleteWorkflow(db, projectId, workflow.id)).toThrow(WorkflowMutationError);
    db.update(s.runs).set({ status: 'completed' }).where(eq(s.runs.workflowId, workflow.id)).run();
    expect(saveWorkflow(db, projectId, { id: workflow.id, name: 'W2', description: '', definition }).name).toBe('W2');
    expect(deleteWorkflow(db, projectId, workflow.id)).toEqual({ ok: true });
  });
});
