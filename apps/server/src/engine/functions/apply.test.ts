import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, workflowDefinitionSchema, type ApplyFunctionName } from '@tw/shared';
import { openDatabase } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import { importProject } from '../../services/importer.ts';
import { snapshotWorkflowModels } from '../../services/routes.ts';
import { createRun } from '../run-create.ts';
import { APPLY_TOPICS, applyFunctions, applyItems } from './apply.ts';
import { HUMAN_OWNED_NOTE, syncFunctions, type FunctionInput } from './index.ts';

const at = { x: 0, y: 0 };

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Harbor' }],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." },
      { key: 'a2', group: 'g1', speaker: 'Bob', source: 'Sorry, boss.' },
    ],
  });
  const { projectId } = importProject(db, file);
  const definition = workflowDefinitionSchema.parse({
    nodes: [{ id: 'entry', type: 'entry', position: at, config: {} }, { id: 'apply', type: 'function', position: at, config: { fn: 'saveTerms', params: {} } }, { id: 'end', type: 'end', position: at }],
    edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'apply' }, { id: '2', source: 'apply', sourceHandle: 'out', target: 'end' }],
  });
  const workflow = db.insert(s.workflows).values({ projectId, name: 'wf', definition }).returning().get();
  const run = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
  const runId = (run as { id?: string }).id ?? db.select().from(s.runs).get()!.id;
  // The step before the apply node: an AI node "ai" whose output the items carry (apply() puts it on their way).
  const ai = { id: 'ai', type: 'ai', position: at, config: { model: { connectionId: 'c', model: 'm' }, instructions: 'x' } };
  db.update(s.runs).set({ definition: workflowDefinitionSchema.parse({ ...definition, nodes: [...definition.nodes, ai] }) }).where(eq(s.runs.id, runId)).run();
  return { db, projectId, runId };
}
type Ctx = ReturnType<typeof setup>;

/** Runs an apply function on a line as the runner would: inside a transaction, with the source node's output in the item. */
function apply(ctx: Ctx, fn: ApplyFunctionName, params: Record<string, unknown>, output: Record<string, unknown> | undefined, key = 'a1') {
  const unit = ctx.db.select().from(s.units).where(eq(s.units.key, key)).get()!;
  const item = ctx.db.select().from(s.runItems).where(eq(s.runItems.subjectId, unit.id)).get()!;
  const data = { ...item.data, path: [{ nodeId: 'entry', port: 'out', at: 0 }, { nodeId: 'ai', port: 'out', at: 0 }], outputs: output ? { ai: output } : ({} as Record<string, Record<string, unknown>>) };
  const input: FunctionInput = { subject: 'lines', unit, item: { ...item, nodeId: 'apply', data }, tagIds: [], projectId: ctx.projectId, runId: ctx.runId };
  return ctx.db.transaction((tx) => applyFunctions[fn](tx, params, input));
}

/** The project's tags besides the one every project starts with (AI 실패). */
const tagsOfProject = (ctx: { db: { select: () => { from: (table: typeof s.tags) => { all: () => (typeof s.tags.$inferSelect)[] } } } }) => ctx.db.select().from(s.tags).all().filter((tag) => tag.role !== 'aiFailed');

describe('apply node mapping', () => {
  it('reads list items by the field map, drops items missing a required field and takes the first of a lines field', () => {
    const { items, skipped } = applyItems('saveSpeechRules', { list: 'rules', map: { fromName: 'speaker', toName: 'listener', level: 'level', startKey: 'at' } }, {
      rules: [{ speaker: 'Bob', listener: 'Alice', level: 'hae', at: ['a2'] }, { speaker: 'Bob', listener: '', level: 'hae' }],
    });
    expect(items).toEqual([{ fromName: 'Bob', toName: 'Alice', level: 'hae', startKey: ['a2'] }]);
    expect(skipped).toBe(1);
  });

  it('reads nested list fields by sub-field', () => {
    const { items } = applyItems('saveRelationships', { list: 'rels', map: { views: 'sides', 'views.from': 'who', 'views.changes': 'shifts', 'views.changes.kind': 'now' } }, {
      rels: [{ sides: [{ who: 'Bob', to: 'Alice', kind: '부하', shifts: [{ at: ['a2'], now: '경계' }, { at: [], now: '무시' }] }, { who: 'Alice', to: 'Bob' }] }],
    });
    // Three levels deep: the second view has no kind, so it is left out; the change without a line too.
    expect(items[0]!.views).toEqual([{ from: 'Bob', to: 'Alice', kind: '부하', changes: [{ at: ['a2'], kind: '경계' }] }]);
  });
});

describe('apply nodes', () => {
  it('refuses a node whose required mapping is empty', () => {
    const ctx = setup();
    expect(() => apply(ctx, 'saveTerms', { list: 'terms', map: {} }, { terms: [] })).toThrow('연결이 비어');
    expect(() => apply(ctx, 'setListener', { map: {} }, {})).toThrow('연결이 비어');
  });

  it('writes a batch\'s terms, skips non-leader lines and files no proposal', () => {
    const ctx = setup();
    const params = { list: 'terms', map: { source: 'source', target: 'target', kind: 'kind', meaning: 'meaning' } };
    const output = { terms: [{ source: 'boss', target: '선장님', kind: 'title', meaning: '선장 호칭' }, { source: 'mast', target: '' }], batchLeader: true };
    expect(apply(ctx, 'saveTerms', params, output).output).toMatchObject({ applied: true, items: 2 });
    expect(apply(ctx, 'saveTerms', params, { terms: [], batchLeader: false }, 'a2').output).toEqual({ batchSkipped: true });
    expect(ctx.db.select().from(s.terms).all().map((t) => [t.source, t.target, t.status])).toEqual([['boss', '선장님', 'confirmed'], ['mast', '', 'candidate']]);
    expect(ctx.db.select().from(s.proposals).all()).toHaveLength(0);
  });

  it('fills only what is empty in the glossary and follows the AI 문맥 switch', () => {
    const ctx = setup();
    ctx.db.insert(s.terms).values({ projectId: ctx.projectId, source: 'boss', target: '', status: 'candidate', origin: 'script' }).run();
    const result = apply(ctx, 'saveTerms', { list: 'terms', map: { source: 'source', target: 'target' } }, { terms: [{ source: 'Boss', target: '선장님' }, { source: 'mast', target: '돛대' }], batchLeader: true });
    expect(result.output).toMatchObject({ applied: true, added: 1, filled: 1 });
    expect(ctx.db.select().from(s.terms).all().map((t) => [t.source, t.target, t.origin])).toEqual([['boss', '선장님', 'script'], ['mast', '돛대', 'ai']]);
    // Candidates when the project's AI 문맥 switch is off.
    ctx.db.update(s.projects).set({ aiAutoConfirm: false }).run();
    apply(ctx, 'saveTerms', { list: 'terms', map: { source: 'source', target: 'target' } }, { terms: [{ source: 'sail', target: '돛' }], batchLeader: true });
    expect(ctx.db.select().from(s.terms).where(eq(s.terms.source, 'sail')).get()?.status).toBe('candidate');
  });

  it('never rewrites a person\'s character: new facts are appended, unknown fields are filled, new people are added', () => {
    const ctx = setup();
    ctx.db.insert(s.characters).values({ projectId: ctx.projectId, name: 'Alice', profile: '사람이 씀', origin: 'human', statusBy: 'human' }).run();
    const params = { list: 'people', map: { name: 'name', newFacts: 'newFacts', gender: 'gender' } };
    const output = { people: [{ name: 'Alice', newFacts: [{ text: 'AI가 안 사실', evidence: ['x'] }], gender: 'female' }, { name: 'Bob', newFacts: [{ text: '선원' }, { text: '말이 적다' }], gender: 'weird' }], batchLeader: true };
    apply(ctx, 'saveCharacters', params, output);
    const people = new Map(ctx.db.select().from(s.characters).all().map((c) => [c.name, c]));
    expect(people.get('Alice')).toMatchObject({ profile: '사람이 씀\nAI가 안 사실', gender: 'female', origin: 'human', evidence: ['x'] });
    expect(people.get('Bob')).toMatchObject({ profile: '선원\n말이 적다', origin: 'ai', statusBy: 'ai' });
  });

  it('인물 저장 appends new facts to an imported profile without a proposal and reports the counts', () => {
    const ctx = setup();
    ctx.db.insert(s.characters).values({ projectId: ctx.projectId, name: 'Alice', profile: '가져온 프로필', aliases: [], origin: 'import' }).run();
    const params = { list: 'people', map: { name: 'name', newFacts: 'newFacts', newSpeech: 'newSpeech', aliases: 'aliases' } };
    const output = { people: [{ name: 'Alice', newFacts: [{ text: '새 사실', evidence: ['a1'] }, { text: '가져온 프로필' }], newSpeech: [{ text: '반말' }], aliases: ['Al'] }], batchLeader: true };
    expect(apply(ctx, 'saveCharacters', params, output).output).toMatchObject({ applied: true, added: 0, filled: 1, appended: 1 });
    expect(ctx.db.select().from(s.characters).get()).toMatchObject({ profile: '가져온 프로필\n새 사실', speech: '반말', aliases: ['Al'], evidence: ['a1'] });
    expect(ctx.db.select().from(s.proposals).all()).toHaveLength(0);
    // Saved again, nothing is new.
    expect(apply(ctx, 'saveCharacters', params, output).output).toMatchObject({ applied: true, added: 0, filled: 0, appended: 0 });
    expect(ctx.db.select().from(s.characters).get()!.profile).toBe('가져온 프로필\n새 사실');
  });

  it('writes relationships with their changes, rules with the first start line, and events not stored yet', () => {
    const ctx = setup();
    ctx.db.insert(s.characters).values([{ projectId: ctx.projectId, name: 'Alice' }, { projectId: ctx.projectId, name: 'Bob' }]).run();
    ctx.db.insert(s.storyEvents).values({ projectId: ctx.projectId, title: '지각' }).run();
    apply(ctx, 'saveRelationships', { list: 'r', map: { views: 'views' } }, { r: [{ between: ['Alice', 'Bob'], views: [{ from: 'Bob', to: 'Alice', kind: '부하', changes: [{ at: ['a2'], kind: '경계', cause: '지각' }] }] }], batchLeader: true });
    apply(ctx, 'saveSpeechRules', { list: 'r', map: { fromName: 'a', toName: 'b', level: 'l', startKey: 's' } }, { r: [{ a: 'Bob', b: 'Alice', l: 'haeyo', s: ['a2'] }, { a: 'Bob', b: 'Alice', l: 'nonsense' }], batchLeader: true });
    apply(ctx, 'saveEvents', { list: 'e', map: { title: 't' } }, { e: [{ t: '지각' }], batchLeader: true });
    expect(ctx.db.select().from(s.relationships).get()).toMatchObject({ kind: '부하', changes: [{ at: 'a2', kind: '경계', cause: '지각' }] });
    // The one direction the script shows is the one row.
    expect(ctx.db.select().from(s.relationships).all()).toHaveLength(1);
    expect(ctx.db.select().from(s.speechRules).get()).toMatchObject({ fromName: 'Bob', startKey: 'a2' });
    expect(ctx.db.select().from(s.storyEvents).all()).toHaveLength(1);
  });

  it('writes only over an untouched AI document', () => {
    const ctx = setup();
    ctx.db.insert(s.documents).values({ projectId: ctx.projectId, title: '개요', kind: 'note', body: '옛', origin: 'human', statusBy: 'human' }).run();
    const params = { map: { title: 't', body: 'b' } };
    const written = apply(ctx, 'saveDocument', params, { t: '개요', b: '새', batchLeader: true });
    expect(written.output).toMatchObject({ document: 'kept' });
    expect(ctx.db.select().from(s.documents).get()?.body).toBe('옛');
  });

  it('writes a candidate into the line unless a person saved the translation', () => {
    const ctx = setup();
    const params = { map: { text: 'text' } };
    ctx.db.update(s.runs).set({ scope: { statusIds: [ctx.db.select().from(s.statuses).get()!.id] } }).run();
    const fresh = apply(ctx, 'saveCandidate', params, { text: '늦었군.' }, 'a1');
    expect(fresh.output).toMatchObject({ applied: true });
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a1')).get()).toMatchObject({ translation: '늦었군.', statusBy: 'ai' });
    expect(ctx.db.select().from(s.candidates).all()).toHaveLength(1);
    ctx.db.update(s.units).set({ translation: '사람이 씀', statusBy: 'human' }).where(eq(s.units.key, 'a2')).run();
    const owned = apply(ctx, 'saveCandidate', params, { text: '죄송' }, 'a2');
    expect(owned.output).toMatchObject({ applied: false });
    expect(owned.issues).toEqual([HUMAN_OWNED_NOTE]);
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a2')).get()?.translation).toBe('사람이 씀');
    expect(ctx.db.select().from(s.candidates).all()).toHaveLength(2);
  });

  it('sets a listener as an AI guess, never over a person\'s, and records nothing for unknown', () => {
    const ctx = setup();
    const params = { map: { listener: 'value', confidence: 'confidence' } };
    apply(ctx, 'setListener', params, { value: 'Bob', confidence: 0.8 }, 'a1');
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a1')).get()).toMatchObject({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 0.8 });
    ctx.db.update(s.units).set({ listener: 'Guard', listenerOrigin: 'human' }).where(eq(s.units.key, 'a2')).run();
    const kept = apply(ctx, 'setListener', params, { value: 'Alice', confidence: 1 }, 'a2');
    expect(kept.output).toMatchObject({ recorded: false });
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a2')).get()?.listener).toBe('Guard');
    // A choice with no answer (value null) applies nothing.
    expect(apply(ctx, 'setListener', params, { value: null, confidence: 0 }, 'a1').output).toMatchObject({ applied: false });
    // "unknown" is the AI saying it cannot tell: the line stays 청자 미상.
    expect(apply(ctx, 'setListener', params, { value: 'unknown', confidence: 0.95 }, 'a2').output).toMatchObject({ recorded: false, reason: '청자 미상' });
  });

  it('tags lines by name and never creates a tag', () => {
    const ctx = setup();
    const tag = ctx.db.insert(s.tags).values({ projectId: ctx.projectId, name: '긴급', color: 'x' }).returning().get();
    const params = { map: { tag: 'value' } };
    apply(ctx, 'tagLines', params, { value: '긴급' }, 'a1');
    expect(ctx.db.select().from(s.unitTags).all().map((row) => row.tagId)).toEqual([tag.id]);
    expect(apply(ctx, 'tagLines', params, { value: '없는 태그' }, 'a2').output).toMatchObject({ tagged: false });
    expect(tagsOfProject(ctx)).toHaveLength(1);
  });

  it('is registered as instant functions and names the topics it writes', () => {
    expect(Object.keys(syncFunctions)).toEqual(expect.arrayContaining(Object.keys(APPLY_TOPICS)));
    expect(APPLY_TOPICS.saveTerms).toEqual(['terms']);
    expect(APPLY_TOPICS.saveEvents).toContain('knowledge');
  });
});

describe('태그 붙이기 / 떼기', () => {
  const tagNamesOf = (ctx: Ctx, key: string) => {
    const unit = ctx.db.select().from(s.units).where(eq(s.units.key, key)).get()!;
    const tags = tagsOfProject(ctx);
    return ctx.db.select().from(s.unitTags).where(eq(s.unitTags.unitId, unit.id)).all().map((row) => tags.find((tag) => tag.id === row.tagId)!.name).sort();
  };

  it('adds and removes the tags picked in the pane', () => {
    const ctx = setup();
    const urgent = ctx.db.insert(s.tags).values({ projectId: ctx.projectId, name: '긴급', color: 'x' }).returning().get();
    expect(apply(ctx, 'tagLines', { action: 'add', tagIds: [urgent.id] }, undefined, 'a1').output).toMatchObject({ tagged: true, action: 'add', tags: ['긴급'] });
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급']);
    apply(ctx, 'tagLines', { action: 'remove', tagIds: [urgent.id] }, undefined, 'a1');
    expect(tagNamesOf(ctx, 'a1')).toEqual([]);
    // Picked 문제 유형 are created in the project the first time they are put on.
    expect(tagsOfProject(ctx)).toHaveLength(1);
    apply(ctx, 'tagLines', { action: 'add', kinds: ['format'] }, undefined, 'a1');
    expect(tagsOfProject(ctx).map((tag) => tag.role)).toEqual([null, 'format']);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['형식']);
  });

  it('names its tags by a field of the previous result: problem types are created on first use, other names only match', () => {
    const ctx = setup();
    ctx.db.insert(s.tags).values({ projectId: ctx.projectId, name: '긴급', color: 'x' }).run();
    const params = { action: 'add', map: { tag: 'categories' } };
    apply(ctx, 'tagLines', params, { categories: ['speech', '용어', '긴급', '없는 태그'] }, 'a1');
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '말투', '용어']);
    expect(tagsOfProject(ctx).map((tag) => tag.name).sort()).toEqual(['긴급', '말투', '용어']);
    expect(apply(ctx, 'tagLines', params, { categories: ['없는 태그'] }, 'a2').output).toMatchObject({ tagged: false });
    expect(apply(ctx, 'tagLines', params, undefined, 'a2').output).toMatchObject({ tagged: false });
    // A single text field works too (a check's kind).
    apply(ctx, 'tagLines', { action: 'remove', map: { tag: 'kind' } }, { kind: 'speech' }, 'a1');
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '용어']);
  });

  it('a pass-path 떼기 removes only its own kinds and leaves another check\'s tag; allKinds removes every problem type but not the person\'s tags', () => {
    const ctx = setup();
    const urgent = ctx.db.insert(s.tags).values({ projectId: ctx.projectId, name: '긴급', color: 'x' }).returning().get();
    apply(ctx, 'tagLines', { action: 'add', tagIds: [urgent.id], kinds: ['format', 'term'] }, undefined, 'a1');
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '용어', '형식']);
    apply(ctx, 'tagLines', { action: 'remove', map: { tag: 'kind' } }, { kind: 'format', passed: true }, 'a1');
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '용어']);
    apply(ctx, 'tagLines', { action: 'remove', allKinds: true }, undefined, 'a1');
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급']);
  });

  it('refuses a node with nothing to tag', () => {
    const ctx = setup();
    expect(() => apply(ctx, 'tagLines', { action: 'add' }, { x: 1 }, 'a1')).toThrow();
  });
});

describe('checks only judge', () => {
  it('formatCheck and glossaryCheck return a verdict and their kind and touch no tags', () => {
    const ctx = setup();
    const unit = ctx.db.select().from(s.units).where(eq(s.units.key, 'a1')).get()!;
    const item = ctx.db.select().from(s.runItems).where(eq(s.runItems.subjectId, unit.id)).get()!;
    const input: FunctionInput = { subject: 'lines', unit, item: { ...item, data: { ...item.data, candidateText: '' } }, tagIds: [], projectId: ctx.projectId, runId: ctx.runId };
    const format = ctx.db.transaction((tx) => syncFunctions.formatCheck!(tx, {}, input));
    expect(format).toMatchObject({ port: 'fail', output: { passed: false, kind: 'format' } });
    const glossary = ctx.db.transaction((tx) => syncFunctions.glossaryCheck!(tx, {}, { ...input, item: { ...item, data: { ...item.data, candidateText: '좋아' } } }));
    expect(glossary).toMatchObject({ port: 'pass', output: { kind: 'term' } });
    expect(format).not.toHaveProperty('issueTags');
    expect(glossary).not.toHaveProperty('issueTags');
    expect(tagsOfProject(ctx)).toEqual([]);
    expect(ctx.db.select().from(s.unitTags).all()).toEqual([]);
  });
});
