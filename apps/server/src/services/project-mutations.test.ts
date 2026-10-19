import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema, translationTemplate } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { createStatus, createTag, deleteStatuses, orderTags, projectTags, TaxonomyMutationError, updateStatus } from './project-taxonomy.ts';
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
    expect(() => deleteStatuses(db, projectId, [initial.id], final.id)).toThrow(TaxonomyMutationError);
    expect(db.select().from(s.statuses).where(eq(s.statuses.id, initial.id)).get()).toBeDefined();
    expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()?.statusId).toBe(initial.id);

    db.update(s.units).set({ translation: '번역' }).where(eq(s.units.id, unit.id)).run();
    expect(updateStatus(db, projectId, initial.id, { kind: 'final' }).kind).toBe('final');
  });

  it('keeps at least one initial and one final status', () => {
    const { db, projectId, initial, final } = setup();
    const normal = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'normal'))).get()!;
    expect(() => deleteStatuses(db, projectId, [initial.id], normal.id)).toThrow('처음 상태는 하나 이상 있어야 합니다.');
    expect(() => updateStatus(db, projectId, final.id, { kind: 'normal' })).toThrow('완료 상태는 하나 이상 있어야 합니다.');
  });

  it('deletes several statuses at once, moving their lines, but not every start status together', () => {
    const { db, projectId, unit, initial } = setup();
    const extra = createStatus(db, projectId, { name: 'Extra initial', kind: 'initial' });
    const a = createStatus(db, projectId, { name: 'A' });
    const b = createStatus(db, projectId, { name: 'B' });
    db.update(s.units).set({ statusId: a.id }).where(eq(s.units.id, unit.id)).run();
    expect(() => deleteStatuses(db, projectId, [initial.id, extra.id], a.id)).toThrow('처음 상태는 하나 이상 있어야 합니다.');
    expect(() => deleteStatuses(db, projectId, [a.id, b.id], a.id)).toThrow('삭제할 상태로는 옮길 수 없습니다.');
    expect(deleteStatuses(db, projectId, [a.id, b.id, extra.id], initial.id)).toMatchObject({ ok: true, deleted: 3 });
    expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()?.statusId).toBe(initial.id);
  });

  it('lists a person\'s tags in the order they set, new ones last', () => {
    const { db, projectId } = setup();
    const [x, y] = ['X', 'Y'].map((name) => createTag(db, projectId, { name }));
    orderTags(db, projectId, [y!.id, x!.id]);
    const z = createTag(db, projectId, { name: 'A' });
    const own = projectTags(db, projectId).filter((tag) => !tag.role).map((tag) => tag.id);
    expect(own).toEqual([y!.id, x!.id, z.id]);
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
