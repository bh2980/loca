import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, toolRoute, TOOL_NAMES, type ProposalDetail, type ProposalDetailKind } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentTools, type ToolDef } from './agent-tools.ts';
import { importProject } from './importer.ts';
import { propose } from './proposals.ts';
import { proposalDetails } from './proposal-details.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: '인트로' }], units: [{ key: 'u1', group: 'g', speaker: 'Tomato', source: 'Hello there, new Townframer.' }] }));
  const alice = db.insert(s.characters).values({ projectId, name: 'Alice', profile: '밝은 성격', gender: 'female' }).returning().get();
  const details = (tool: string, input: Record<string, unknown>) => proposalDetails(db, propose(db, { projectId, sessionId: null, source: 'cli', tool, input }));
  return { db, projectId, alice, details };
}

const of = <K extends ProposalDetailKind>(details: ProposalDetail[], kind: K) => details.find((detail): detail is Extract<ProposalDetail, { kind: K }> => detail.kind === kind)!;
/** A `fields` detail as label → value. */
const rows = (details: ProposalDetail[]) => Object.fromEntries(details.flatMap((detail) => (detail.kind === 'fields' ? detail.rows.map((row) => [row.label, row.value]) : [])));

describe('what a proposal card says it changes', () => {
  it('names the item and shows old and new values of the fields that change (not yet accepted)', () => {
    const { alice, details } = setup();
    expect(details('save_knowledge', { characters: [{ id: alice.id, profile: '조용하고 신중한 성격', gender: 'female' }] })).toEqual([{
      kind: 'changes',
      // The gender is the same as now: not a change.
      items: [{ title: '수정 · 인물 · Alice', changes: [{ field: '프로필', before: '밝은 성격', after: '조용하고 신중한 성격' }] }],
    }]);
  });

  it('says what a new item will hold', () => {
    const { details } = setup();
    const { items } = of(details('save_knowledge', { characters: [{ name: 'Bob', aliases: ['밥', 'B'] }], documents: [{ title: '세계관', body: '...', alwaysInclude: true }] }), 'changes');
    expect(items.map((item) => item.title)).toEqual(['추가 · 인물 · Bob', '추가 · 노트 · 세계관']);
    expect(items[0]!.changes).toEqual([{ field: '이름', after: 'Bob' }, { field: '별칭', after: '밥, B' }]);
    expect(items[1]!.changes.find((change) => change.field === '문맥에 넣기')).toEqual({ field: '문맥에 넣기', after: '예' });
  });

  it('shows a speech rule and a relationship by who speaks to whom, from the single save as from the batch', () => {
    const { db, projectId, details } = setup();
    const rule = db.insert(s.speechRules).values({ projectId, fromName: 'Alice', toName: 'Bob', level: 'hae', note: '' }).returning().get();
    const expected = [{ kind: 'changes', items: [{ title: '수정 · 말투 규칙 · Alice → Bob', changes: [{ field: '말투', before: '해체(반말)', after: '해요체' }, { field: '메모', before: '(비어 있음)', after: '직장 선배' }] }] }];
    expect(details('save_knowledge', { speechRules: [{ id: rule.id, level: 'haeyo', note: '직장 선배' }] })).toEqual(expected);
    expect(details('save_speech_rule', { id: rule.id, level: 'haeyo', note: '직장 선배' })).toEqual(expected);
  });

  it('after it is accepted, the old values come from what undoing it would restore', () => {
    const { db, projectId, alice } = setup();
    const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'save_knowledge', input: { characters: [{ id: alice.id, profile: '새 프로필' }] } });
    // The change is applied (the row holds the new value) and the undo calls hold what it had.
    db.update(s.characters).set({ profile: '새 프로필' }).where(eq(s.characters.id, alice.id)).run();
    const accepted = db.update(s.proposals).set({ status: 'accepted', undo: { calls: [{ tool: 'save_knowledge', input: { characters: [{ id: alice.id, profile: '밝은 성격' }] } }] } }).where(eq(s.proposals.id, proposal.id)).returning().get();
    expect(of(proposalDetails(db, accepted), 'changes').items[0]!.changes).toEqual([{ field: '프로필', before: '밝은 성격', after: '새 프로필' }]);
    // A single save restores with a call of its own tool.
    const single = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'save_character', input: { id: alice.id, profile: '새 프로필' } });
    const done = db.update(s.proposals).set({ status: 'accepted', undo: { calls: [{ tool: 'save_character', input: { id: alice.id, profile: '밝은 성격' } }] } }).where(eq(s.proposals.id, single.id)).returning().get();
    expect(of(proposalDetails(db, done), 'changes').items[0]!.changes).toEqual([{ field: '프로필', before: '밝은 성격', after: '새 프로필' }]);
  });

  it('names the line, scene and status a tool names by id', () => {
    const { db, projectId, details } = setup();
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
    const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
    const [initial, other] = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    expect(rows(details('update_unit', { unitId: unit.id, groupId: group.id, speaker: 'Toto' }))).toEqual({ '원문 항목': 'u1 · Tomato: Hello there, new Townframer.', 묶음: '인트로', 화자: 'Toto' });
    const deleting = details('delete_status', { ids: [initial!.id], moveTo: other!.id });
    expect(rows(deleting)).toEqual({ '삭제할 상태': initial!.name, '대사를 옮길 상태': other!.name });
    // What accepting does is said only while the proposal waits.
    expect(of(deleting, 'note')).toEqual({ kind: 'note', tone: 'danger', text: '대사의 상태가 바뀌고 상태를 삭제합니다.', whilePending: true });
    // An id the project does not have is shown as written.
    expect(rows(details('delete_group', { groupId: 'gone' }))).toEqual({ '삭제할 묶음': 'gone' });
  });

  it('counts a batch of line changes and lists the first of them', () => {
    const { details } = setup();
    const changes = Array.from({ length: 60 }, (_, index) => ({ key: `k${index}`, ...(index % 2 ? { translation: `번역 ${index}` } : { status: '완료', addTags: ['검수'], removeTags: ['초벌'] }) }));
    const lines = of(details('propose_changes', { changes }), 'lines');
    expect([lines.total, lines.translations, lines.statuses, lines.tagged, lines.shown.length]).toEqual([60, 30, 30, 30, 50]);
    expect(lines.shown.slice(0, 2)).toEqual([{ key: 'k0', change: '→ 완료 +#검수 −#초벌' }, { key: 'k1', translation: '번역 1' }]);
  });

  it('shows the input as written for a tool that says nothing of its own, and for a tool that is not there', () => {
    const { details } = setup();
    expect(details('link_lines', { from: 'a', to: 'b', action: 'link' })).toEqual([{ kind: 'text', format: 'plain', text: JSON.stringify({ from: 'a', to: 'b', action: 'link' }, null, 2) }]);
    expect(details('no_such_tool', { x: 1 })).toEqual([{ kind: 'text', format: 'plain', text: '{\n  "x": 1\n}' }]);
    // An input a preview cannot read (an older shape) is shown as written, not thrown.
    expect(details('save_terms', { terms: 'oops' })[0]).toMatchObject({ kind: 'text' });
  });
});

describe('a card is drawn from its tool\'s own definition', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));

  it('nothing that makes or draws details looks a tool up by name', () => {
    const files = [path.join(root, 'proposal-details.ts'), path.join(root, 'proposal-preview.ts'), path.join(root, '../../../web/src/components/chat/change-preview.tsx')];
    const named = files.flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return TOOL_NAMES.filter((name) => new RegExp(`['"\`]${name}['"\`]`).test(text)).map((name) => `${path.basename(file)}: ${name}`);
    });
    expect(named).toEqual([]);
  });

  it('every preview is a member of a tool that goes through the gate (only those become proposals)', () => {
    const db = openDatabase(':memory:');
    const tools = agentTools(db, 'p', undefined, { unrestricted: true }) as Record<string, ToolDef>;
    expect(Object.entries(tools).filter(([name, tool]) => tool.preview && toolRoute(name) !== 'gate').map(([name]) => name)).toEqual([]);
  });
});
