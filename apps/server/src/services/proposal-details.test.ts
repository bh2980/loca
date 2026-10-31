import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { propose } from './proposals.ts';
import { proposalDetails } from './proposal-details.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: '인트로' }], units: [{ key: 'u1', group: 'g', speaker: 'Tomato', source: 'Hello there, new Townframer.' }] }));
  const alice = db.insert(s.characters).values({ projectId, name: 'Alice', profile: '밝은 성격', gender: 'female' }).returning().get();
  return { db, projectId, alice };
}

describe('what a proposal card says it changes', () => {
  it('names the item and shows old and new values of the fields that change (not yet accepted)', () => {
    const { db, projectId, alice } = setup();
    const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'save_knowledge', input: { characters: [{ id: alice.id, profile: '조용하고 신중한 성격', gender: 'female' }] } });
    const details = proposalDetails(db, proposal)!;
    expect(details.items).toEqual([{
      kind: 'characters',
      action: '수정',
      label: 'Alice',
      // The gender is the same as now: not a change.
      changes: [{ field: '프로필', before: '밝은 성격', after: '조용하고 신중한 성격' }],
    }]);
  });

  it('says what a new item will hold', () => {
    const { db, projectId } = setup();
    const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'save_knowledge', input: { characters: [{ name: 'Bob', aliases: ['밥', 'B'] }], documents: [{ title: '세계관', body: '...', alwaysInclude: true }] } });
    const details = proposalDetails(db, proposal)!;
    expect(details.items.map((item) => [item.action, item.kind, item.label])).toEqual([['추가', 'characters', 'Bob'], ['추가', 'documents', '세계관']]);
    expect(details.items[0].changes).toEqual([{ field: '이름', after: 'Bob' }, { field: '별칭', after: '밥, B' }]);
    expect(details.items[1].changes.find((change) => change.field === '문맥에 넣기')).toEqual({ field: '문맥에 넣기', after: '예' });
  });

  it('shows a speech rule and a relationship by who speaks to whom', () => {
    const { db, projectId } = setup();
    const rule = db.insert(s.speechRules).values({ projectId, fromName: 'Alice', toName: 'Bob', level: 'hae', note: '' }).returning().get();
    const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'save_knowledge', input: { speechRules: [{ id: rule.id, level: 'haeyo', note: '직장 선배' }] } });
    const [item] = proposalDetails(db, proposal)!.items;
    expect(item.label).toBe('Alice → Bob');
    expect(item.changes).toEqual([{ field: '말투', before: 'hae', after: 'haeyo' }, { field: '메모', before: '(비어 있음)', after: '직장 선배' }]);
  });

  it('after it is accepted, the old values come from what undoing it would restore', () => {
    const { db, projectId, alice } = setup();
    const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'save_knowledge', input: { characters: [{ id: alice.id, profile: '새 프로필' }] } });
    // The change is applied (the row holds the new value) and the undo calls hold what it had.
    db.update(s.characters).set({ profile: '새 프로필' }).where(eq(s.characters.id, alice.id)).run();
    const accepted = db.update(s.proposals).set({ status: 'accepted', undo: { calls: [{ tool: 'save_knowledge', input: { characters: [{ id: alice.id, profile: '밝은 성격' }] } }] } }).where(eq(s.proposals.id, proposal.id)).returning().get();
    expect(proposalDetails(db, accepted)!.items[0].changes).toEqual([{ field: '프로필', before: '밝은 성격', after: '새 프로필' }]);
  });

  it('names the line, scene and status a tool names by id', () => {
    const { db, projectId } = setup();
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
    const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
    const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'update_unit', input: { unitId: unit.id, groupId: group.id, speaker: 'Toto' } });
    const { refs } = proposalDetails(db, proposal)!;
    expect(refs[unit.id]).toBe('u1 · Tomato: Hello there, new Townframer.');
    expect(refs[group.id]).toBe('인트로');
  });

  it('has nothing to add for a tool whose card already says it all', () => {
    const { db, projectId } = setup();
    const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'save_terms', input: { terms: [{ source: 'Townframe', target: '타운프레임' }] } });
    expect(proposalDetails(db, proposal)).toBeNull();
  });
});
