import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema, messageChips } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { chatRunScope } from './chat-run-scope.ts';
import { mergeIncoming } from './chat-context.ts';

const setup = () => {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'P' },
    groups: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
    units: [
      { key: 'u1', group: 'a', source: 'one', speaker: 'Reeve' },
      { key: 'u2', group: 'a', source: 'two', speaker: 'The Lookout' },
      { key: 'u3', group: 'b', source: 'three', speaker: 'Lookout' },
    ],
    characters: [{ name: 'Lookout', aliases: ['The Lookout'] }, { name: 'Silent' }],
    terms: [{ source: 'Rat', target: '쥐' }],
  });
  const { projectId } = importProject(db, file, null as never);
  const workflows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all();
  const lines = workflows.find((workflow) => workflow.name === '번역')!;
  // A workflow whose entry takes terms.
  const termWorkflow = db.insert(s.workflows).values({ projectId, name: '용어 시험', definition: { nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { input: 'terms' } }], edges: [], settings: {} } as never }).returning().get();
  return { db, projectId, lines, termWorkflow, groups: db.select().from(s.groups).all(), units: db.select().from(s.units).all(), characters: db.select().from(s.characters).all(), terms: db.select().from(s.terms).all(), status: db.select().from(s.statuses).get()! };
};

describe('what the picks of a /workflow run mean as a run scope', () => {
  it('scenes become groupIds, lines unitIds, tags tagIds, statuses statusIds', () => {
    const { db, projectId, lines, groups, units, status } = setup();
    expect(chatRunScope(db, projectId, lines.id, [{ kind: '장면', id: groups[0].id }, { kind: '상태', id: status.id }])).toMatchObject({ ok: true, input: 'lines', scope: { groupIds: [groups[0].id], statusIds: [status.id] } });
    expect(chatRunScope(db, projectId, lines.id, [{ kind: '대사', id: units[0].id }, { kind: '대사', id: units[1].id }])).toMatchObject({ ok: true, scope: { unitIds: [units[0].id, units[1].id] } });
    expect(chatRunScope(db, projectId, lines.id, [{ kind: '태그', id: 't' }])).toMatchObject({ ok: true, scope: { tagIds: ['t'] } });
  });

  it('a person becomes the lines they speak, by name or alias', () => {
    const { db, projectId, lines, characters, units } = setup();
    const lookout = characters.find((character) => character.name === 'Lookout')!;
    const result = chatRunScope(db, projectId, lines.id, [{ kind: '인물', id: lookout.id }]);
    expect(result).toMatchObject({ ok: true });
    expect(new Set((result as { scope: { unitIds: string[] } }).scope.unitIds)).toEqual(new Set([units[1].id, units[2].id]));
    // a person with no lines is a scope with nothing in it, not every line
    const silent = characters.find((character) => character.name === 'Silent')!;
    expect((chatRunScope(db, projectId, lines.id, [{ kind: '인물', id: silent.id }]) as { scope: { unitIds: string[] } }).scope.unitIds).toEqual(['__none__']);
  });

  it('scenes and lines (or a person) together are refused: the scope would silently narrow itself', () => {
    const { db, projectId, lines, groups, units } = setup();
    expect(chatRunScope(db, projectId, lines.id, [{ kind: '장면', id: groups[0].id }, { kind: '대사', id: units[0].id }])).toMatchObject({ ok: false, error: expect.stringContaining('함께') });
    expect(chatRunScope(db, projectId, lines.id, [{ kind: '대사', id: units[0].id }, { kind: '장면', id: groups[0].id }])).toMatchObject({ ok: false });
  });

  it('only what the workflow takes in: lines workflows refuse terms and notes, terms workflows refuse scenes', () => {
    const { db, projectId, lines, terms, termWorkflow, groups } = setup();
    expect(chatRunScope(db, projectId, lines.id, [{ kind: '용어', id: terms[0].id }])).toMatchObject({ ok: false });
    expect(chatRunScope(db, projectId, lines.id, [{ kind: '노트', id: 'x' }])).toMatchObject({ ok: false });
    expect(chatRunScope(db, projectId, lines.id, [])).toMatchObject({ ok: false });
    expect(chatRunScope(db, projectId, 'missing', [{ kind: '장면', id: groups[0].id }])).toMatchObject({ ok: false });
    expect(chatRunScope(db, projectId, termWorkflow.id, [{ kind: '용어', id: terms[0].id }])).toMatchObject({ ok: true, input: 'terms', scope: { termIds: [terms[0].id] } });
    expect(chatRunScope(db, projectId, termWorkflow.id, [{ kind: '장면', id: groups[0].id }])).toMatchObject({ ok: false });
  });
});

describe('chips on a sent message', () => {
  const chips = [{ kind: '장면', id: 'g1', label: 'Greywater Ferry', href: '/p/1/script?group=g1' }, { kind: '대사', id: 'u1', label: 'REEVE: Excuse me…', detail: 'c1.ferry.002' }];
  it('are kept in the stored message and read back whole', () => {
    const incoming = { id: 'm1', role: 'user' as const, metadata: { chips }, parts: [{ type: 'text' as const, text: '이 장면 봐 줘' }] };
    const stored = mergeIncoming([], incoming as never);
    expect(messageChips(stored[0])).toEqual(chips);
    // a later turn that resends the newest message (an answered approval) keeps them too
    expect(messageChips(mergeIncoming(stored, { ...incoming } as never)[0])).toEqual(chips);
  });
  it('older messages and malformed metadata have none', () => {
    expect(messageChips({})).toEqual([]);
    expect(messageChips({ metadata: { kind: 'decisions' } })).toEqual([]);
    expect(messageChips({ metadata: { chips: [{ nope: 1 }] } })).toEqual([]);
    expect(messageChips({ metadata: { chips: 'x' } })).toEqual([]);
  });
});
