import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { decideProposal, propose } from './proposals.ts';
import { readProjectSettings } from './project-settings.ts';

type Proposal = typeof s.proposals.$inferSelect;
type Call = { tool: string; input: Record<string, unknown> };
type Before = Record<string, unknown>;
type Inverse = { before?: (db: Db, proposal: Proposal) => Before; after: (db: Db, proposal: Proposal, before: Before, result: unknown) => s.ProposalUndo };
const none = (reason: string): s.ProposalUndo => ({ none: reason });
const calls = (...value: Call[]): s.ProposalUndo => ({ calls: value });
const sent = (input: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
const RESTORE_FIELDS: Record<string, string[]> = {
  save_character: ['name', 'aliases', 'profile', 'speech', 'style', 'gender', 'ageBand', 'player', 'status'],
  save_relationship: ['kind', 'description', 'mutual', 'changes', 'status'], save_speech_rule: ['fromName', 'toName', 'level', 'address', 'note', 'startKey', 'evidence', 'status'],
  save_event: ['title', 'summary', 'cause', 'outcome', 'participants', 'evidence', 'status'], save_document: ['kind', 'title', 'body', 'alwaysInclude', 'status'],
};
function rowFor(db: Db, tableName: string, projectId: string, id: string) {
  const tables: Record<string, any> = { save_character: s.characters, save_relationship: s.relationships, save_speech_rule: s.speechRules, save_event: s.storyEvents, save_document: s.documents };
  const table = tables[tableName];
  return table ? db.select().from(table).where(and(eq(table.id, id), eq(table.projectId, projectId))).get() : undefined;
}
function knowledgeBefore(db: Db, proposal: Proposal): Before {
  const input = proposal.input;
  if (proposal.tool === 'save_knowledge') {
    const items: Record<string, unknown[]> = {};
    for (const [kind, values] of Object.entries(input)) if (Array.isArray(values)) items[kind] = values.map((item) => {
      const request = item as Record<string, unknown>, tool = ({ characters: 'save_character', relationships: 'save_relationship', speechRules: 'save_speech_rule', events: 'save_event', documents: 'save_document' } as Record<string, string>)[kind];
      return { id: request.id, row: request.id && tool ? rowFor(db, tool, proposal.projectId, String(request.id)) : null };
    });
    return { items };
  }
  const row = input.id ? rowFor(db, proposal.tool, proposal.projectId, String(input.id)) : null;
  if (proposal.tool === 'save_relationship' && row) {
    const from = db.select({ name: s.characters.name }).from(s.characters).where(eq(s.characters.id, row.fromId)).get()?.name;
    const to = db.select({ name: s.characters.name }).from(s.characters).where(eq(s.characters.id, row.toId)).get()?.name;
    return { row: { ...row, from, to } };
  }
  return { row };
}
function knowledgeAfter(db: Db, proposal: Proposal, before: Before, result: unknown): s.ProposalUndo {
  const output = result as { ok?: boolean; id?: string; results?: { kind: string; index: number; id?: string; ok: boolean }[] };
  if (!output?.ok) return none('변경이 적용되지 않았습니다');
  if (proposal.tool !== 'save_knowledge') {
    if (!proposal.input.id) return output.id ? calls({ tool: 'delete_items', input: { kind: ({ save_character: 'characters', save_relationship: 'relationships', save_speech_rule: 'speechRules', save_event: 'events', save_document: 'documents' } as Record<string, string>)[proposal.tool], ids: [output.id] } }) : none('만든 항목 id를 확인하지 못했습니다');
    const row = (before.row ?? {}) as Record<string, unknown>;
    const fields = sent(proposal.input, RESTORE_FIELDS[proposal.tool] ?? []);
    if (proposal.tool === 'save_relationship') { if (proposal.input.from !== undefined) fields.from = row.from; if (proposal.input.to !== undefined) fields.to = row.to; }
    return calls({ tool: proposal.tool, input: { id: proposal.input.id, ...Object.fromEntries(Object.keys(fields).filter((key) => key in row || key === 'from' || key === 'to').map((key) => [key, (row as any)[key]])) } });
  }
  const itemRows = before.items as Record<string, { id?: string; row: Record<string, unknown> | null }[]>;
  const saves: Record<string, unknown[]> = {}, deletes: Call[] = [];
  for (const [kind, entries] of Object.entries(itemRows)) for (const [index, entry] of entries.entries()) {
    const saved = output.results?.find((r) => r.kind === kind && r.index === index);
    if (!saved?.ok || !saved.id) continue;
    if (entry.id && entry.row) {
      const tool = ({ characters: 'save_character', relationships: 'save_relationship', speechRules: 'save_speech_rule', events: 'save_event', documents: 'save_document' } as Record<string, string>)[kind];
      const original = (proposal.input[kind] as Record<string, unknown>[])[index];
      const fields = sent(original, RESTORE_FIELDS[tool] ?? []);
      saves[kind] ??= []; saves[kind].push({ id: entry.id, ...Object.fromEntries(Object.keys(fields).filter((key) => key in entry.row!).map((key) => [key, entry.row![key]])) });
    } else deletes.push({ tool: 'delete_items', input: { kind, ids: [saved.id] } });
  }
  return { calls: [...(Object.keys(saves).length ? [{ tool: 'save_knowledge', input: saves }] : []), ...deletes] };
}

const INVERSES: Record<string, Inverse> = {
  propose_changes: {
    before(db, proposal) {
      const changes = (proposal.input.changes as Record<string, unknown>[]).map((change) => {
        const unit = db.select().from(s.units).where(and(eq(s.units.projectId, proposal.projectId), eq(s.units.key, String(change.key)))).get();
        if (!unit) return { key: change.key, missing: true };
        const status = db.select({ name: s.statuses.name }).from(s.statuses).where(eq(s.statuses.id, unit.statusId)).get()?.name;
        const tags = db.select({ name: s.tags.name }).from(s.unitTags).innerJoin(s.tags, eq(s.unitTags.tagId, s.tags.id)).where(eq(s.unitTags.unitId, unit.id)).all().map((tag) => tag.name);
        return { key: change.key, translation: unit.translation ?? '', status, tags, listener: unit.listener, touched: Object.keys(change).filter((key) => ['translation', 'status', 'addTags', 'removeTags', 'listener'].includes(key)) };
      });
      return { changes };
    },
    after(db, proposal, before, result) {
      const skipped = new Set(((result as any)?.skipped ?? []).map((entry: any) => entry.key));
      const original = proposal.input.changes as Record<string, any>[];
      const changes = (before.changes as any[]).flatMap((prior) => {
        if (prior.missing || skipped.has(prior.key)) return [];
        const current = db.select().from(s.units).where(and(eq(s.units.projectId, proposal.projectId), eq(s.units.key, prior.key))).get();
        if (!current) return [];
        const touched = new Set(prior.touched), source = original.find((item) => item.key === prior.key)!;
        const nowTags = db.select({ name: s.tags.name }).from(s.unitTags).innerJoin(s.tags, eq(s.unitTags.tagId, s.tags.id)).where(eq(s.unitTags.unitId, current.id)).all().map((tag) => tag.name);
        return [{ key: prior.key, rev: current.updatedAt.getTime(), ...(touched.has('translation') && { translation: prior.translation }), ...(touched.has('status') && { status: prior.status }), ...(touched.has('listener') && { listener: prior.listener ?? '' }), addTags: touched.has('addTags') || touched.has('removeTags') ? prior.tags.filter((tag: string) => !nowTags.includes(tag)) : [], removeTags: touched.has('addTags') || touched.has('removeTags') ? nowTags.filter((tag: string) => !prior.tags.includes(tag)) : [] }].map((change) => ({ ...change, addTags: source.removeTags ? [...new Set([...(change.addTags ?? []), ...source.removeTags.filter((tag: string) => prior.tags.includes(tag))])] : change.addTags, removeTags: source.addTags ? [...new Set([...(change.removeTags ?? []), ...source.addTags.filter((tag: string) => !prior.tags.includes(tag))])] : change.removeTags }));
      });
      return changes.length ? calls({ tool: 'propose_changes', input: { origin: 'human', changes } }) : { calls: [] };
    },
  },
  ...Object.fromEntries(Object.keys(RESTORE_FIELDS).map((tool) => [tool, { before: knowledgeBefore, after: knowledgeAfter }])),
  save_knowledge: { before: knowledgeBefore, after: knowledgeAfter },
  save_terms: {
    before: (db, proposal) => ({ rows: (proposal.input.terms as Record<string, unknown>[]).map((item) => ({ id: item.id, row: item.id ? db.select().from(s.terms).where(and(eq(s.terms.id, String(item.id)), eq(s.terms.projectId, proposal.projectId))).get() : null })) }),
    after: (_db, proposal, before, result) => {
      const output = result as { created?: string[]; skipped?: unknown[] };
      const terms = (proposal.input.terms as Record<string, unknown>[]).flatMap((item, index) => item.id && (before.rows as any[])[index]?.row ? [{ id: item.id, ...sent((before.rows as any[])[index].row, Object.keys(item)) }] : []);
      const deletes = output?.created?.length ? [{ tool: 'delete_items', input: { kind: 'terms', ids: output.created } }] : [];
      return { calls: [...(terms.length ? [{ tool: 'save_terms', input: { terms } }] : []), ...deletes] };
    },
  },
  save_group_summary: { before: (db, p) => ({ description: db.select({ description: s.groups.description }).from(s.groups).where(and(eq(s.groups.id, String(p.input.groupId)), eq(s.groups.projectId, p.projectId))).get()?.description ?? '' }), after: (_db, p, before) => before.description ? calls({ tool: 'save_group_summary', input: { groupId: p.input.groupId, description: before.description } }) : none('이전 장면 요약이 비어 있어 복원할 수 없습니다') },
  tag_items: {
    before(db, p) {
      const tags = db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, p.projectId)).all();
      const links: Record<string, string[]> = {};
      const tables: Record<string, any> = { terms: s.terms, characters: s.characters, relationships: s.relationships, speechRules: s.speechRules, events: s.storyEvents, documents: s.documents };
      const table = tables[p.input.kind as string];
      for (const ref of [...(p.input.add as string[]), ...(p.input.remove as string[])]) {
        const tag = tags.find((row) => row.id === ref || row.name === ref || row.name === ref.replace(/^#/, ''));
        if (tag && table) links[tag.id] = db.select({ id: s.knowledgeTags.itemId }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.kind, p.input.kind as any), eq(s.knowledgeTags.tagId, tag.id), inArray(s.knowledgeTags.itemId, p.input.ids as string[]))).all().map((row) => row.id);
      }
      return { tags, links, ids: p.input.ids, kind: p.input.kind };
    },
    after(_db, p, before) {
      const tags = before.tags as { id: string; name: string }[];
      const ids = p.input.ids as string[];
      const links = before.links as Record<string, string[]>;
      const inverse: Call[] = [];
      for (const [field, adding] of [['add', false], ['remove', true]] as const) for (const ref of p.input[field] as string[]) {
        const tag = tags.find((row) => row.id === ref || row.name === ref || row.name === ref.replace(/^#/, ''));
        if (!tag) continue;
        const had = new Set(links[tag.id] ?? []);
        const changed = ids.filter((id) => had.has(id) !== adding);
        if (changed.length) inverse.push({ tool: 'tag_items', input: { kind: before.kind, ids: changed, add: adding ? [tag.name] : [], remove: adding ? [] : [tag.name] } });
      }
      return { calls: inverse };
    },
  },
  save_status: { before: () => ({}), after: (_db, p, _b, result) => p.input.type === 'tag' && (result as any)?.id ? calls({ tool: 'delete_items', input: { kind: 'tags', ids: [(result as any).id] } }) : none('상태는 지울 수 없습니다') },
  save_workflow: { before: (db, p) => ({ row: p.input.id ? db.select().from(s.workflows).where(and(eq(s.workflows.id, String(p.input.id)), eq(s.workflows.projectId, p.projectId))).get() : null }), after: (_db, p, before) => before.row ? calls({ tool: 'save_workflow', input: { id: p.input.id, name: (before.row as any).name, description: (before.row as any).description, definition: (before.row as any).definition } }) : none('새 워크플로는 되돌릴 수 없습니다') },
  update_project_settings: { before: (db, p) => { const settings = readProjectSettings(db, p.projectId); return { values: sent(settings as unknown as Record<string, unknown>, Object.keys(p.input)) }; }, after: (_db, _p, before) => calls({ tool: 'update_project_settings', input: before.values as Record<string, unknown> }) },
  propose_translation: { after: () => none('후보만 추가했고 현재 번역은 그대로입니다') },
  start_run: { after: () => none('실행 기록은 되돌릴 수 없습니다') },
  delete_items: { after: () => none('삭제된 항목은 되살릴 수 없습니다') },
};

export function undoBefore(db: Db, proposal: Proposal): Before { return INVERSES[proposal.tool]?.before?.(db, proposal) ?? {}; }
export function undoOf(db: Db, proposal: Proposal, before: Before, result: unknown): s.ProposalUndo { return INVERSES[proposal.tool]?.after(db, proposal, before, result) ?? none('이 변경은 되돌릴 수 없습니다'); }

export async function undoProposals(db: Db, sessionId: string, ids: string[]) {
  const rows = db.select().from(s.proposals).where(and(eq(s.proposals.sessionId, sessionId), inArray(s.proposals.id, ids))).all().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const results: { id: string; ok: boolean; error?: string; skipped?: string[] }[] = [];
  for (const original of rows) {
    if (original.status !== 'accepted' || original.undoneAt) { results.push({ id: original.id, ok: false, error: original.undoneAt ? '이미 되돌렸습니다' : '수락된 제안이 아닙니다' }); continue; }
    if (!original.undo || 'none' in original.undo) { results.push({ id: original.id, ok: false, error: original.undo && 'none' in original.undo ? original.undo.none : '되돌리기 정보를 찾을 수 없습니다' }); continue; }
    try {
      const skipped: string[] = [];
      for (const call of original.undo.calls) {
        const inverse = propose(db, { projectId: original.projectId, sessionId, source: original.source, tool: call.tool, input: call.input, review: `되돌리기 (proposal ${original.id})` });
        const applied = await decideProposal(db, inverse.id, true, 'person');
        db.update(s.proposals).set({ reportedAt: new Date() }).where(eq(s.proposals.id, inverse.id)).run();
        if (applied.status !== 'accepted') throw new Error(`되돌리기 제안 실패: ${call.tool}`);
        skipped.push(...(((applied.result as any)?.skipped ?? []).map((item: any) => item.key ?? item.id)));
      }
      db.update(s.proposals).set({ undoneAt: new Date(), reportedAt: null }).where(eq(s.proposals.id, original.id)).run();
      events.changed(original.projectId, 'proposals');
      results.push({ id: original.id, ok: true, ...(skipped.length && { skipped }) });
    } catch (error) { results.push({ id: original.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  for (const id of ids) if (!rows.some((row) => row.id === id)) results.push({ id, ok: false, error: '제안을 찾을 수 없습니다' });
  return results;
}
