import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { KnowledgeKind } from '../db/schema.ts';
import { readProjectSettings } from './project-settings.ts';

type Proposal = typeof s.proposals.$inferSelect;
type Call = s.UndoCall;
type Capture = Record<string, unknown>;
type KnowledgeRow = typeof s.characters.$inferSelect | typeof s.relationships.$inferSelect |
  typeof s.speechRules.$inferSelect | typeof s.storyEvents.$inferSelect | typeof s.documents.$inferSelect;
type Inverse = {
  before?: (db: Db, proposal: Proposal) => Capture;
  after: (db: Db, proposal: Proposal, before: Capture, result: unknown) => s.ProposalUndo;
};

const NONE = '이 변경은 되돌릴 수 없습니다';
const none = (reason: string): s.ProposalUndo => ({ none: reason });
const call = (tool: string, input: Record<string, unknown>, expect?: Call['expect']): Call => ({ tool, input, expect });
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const objectList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const TOOL_BY_KIND: Record<KnowledgeKind, string> = {
  characters: 'save_character', relationships: 'save_relationship',
  speechRules: 'save_speech_rule', events: 'save_event', documents: 'save_document',
};
const KIND_BY_TOOL: Record<string, KnowledgeKind> = {
  save_character: 'characters', save_relationship: 'relationships',
  save_speech_rule: 'speechRules', save_event: 'events', save_document: 'documents',
};
const RESTORE_FIELDS: Record<string, string[]> = {
  save_character: ['name', 'role', 'aliases', 'profile', 'speech', 'style', 'gender', 'ageBand', 'player', 'color', 'status'],
  save_relationship: ['kind', 'description', 'mutual', 'changes', 'status'],
  save_speech_rule: ['fromName', 'toName', 'level', 'address', 'note', 'startKey', 'evidence', 'status'],
  save_event: ['title', 'summary', 'cause', 'outcome', 'participants', 'evidence', 'status'],
  save_document: ['kind', 'title', 'body', 'alwaysInclude', 'status'],
};

function sent(input: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

function rowFor(db: Db, kind: KnowledgeKind, projectId: string, id: string): KnowledgeRow | undefined {
  switch (kind) {
    case 'characters':
      return db.select().from(s.characters).where(and(
        eq(s.characters.id, id), eq(s.characters.projectId, projectId),
      )).get();
    case 'relationships':
      return db.select().from(s.relationships).where(and(
        eq(s.relationships.id, id), eq(s.relationships.projectId, projectId),
      )).get();
    case 'speechRules':
      return db.select().from(s.speechRules).where(and(
        eq(s.speechRules.id, id), eq(s.speechRules.projectId, projectId),
      )).get();
    case 'events':
      return db.select().from(s.storyEvents).where(and(
        eq(s.storyEvents.id, id), eq(s.storyEvents.projectId, projectId),
      )).get();
    case 'documents':
      return db.select().from(s.documents).where(and(
        eq(s.documents.id, id), eq(s.documents.projectId, projectId),
      )).get();
  }
}

function rowValues(row: KnowledgeRow): Record<string, unknown> {
  return { ...row };
}

/** A knowledge row's values, a relationship's with its endpoint names: the one view both undo capture and the conflict check read. */
export function snapshot(db: Db, kind: KnowledgeKind, projectId: string, id: string) {
  const row = rowFor(db, kind, projectId, id);
  if (!row) return undefined;
  const values = rowValues(row);
  if (kind === 'relationships') {
    values.from = db.select({ name: s.characters.name }).from(s.characters)
      .where(eq(s.characters.id, String(values.fromId))).get()?.name;
    values.to = db.select({ name: s.characters.name }).from(s.characters)
      .where(eq(s.characters.id, String(values.toId))).get()?.name;
  }
  return values;
}

function knowledgeBefore(db: Db, proposal: Proposal): Capture {
  if (proposal.tool === 'save_knowledge') {
    const items: Record<string, { request: Record<string, unknown>; row: Record<string, unknown> | null }[]> = {};
    for (const kind of Object.keys(TOOL_BY_KIND) as KnowledgeKind[]) {
      items[kind] = objectList(proposal.input[kind]).map((request) => {
        const row = typeof request.id === 'string'
          ? snapshot(db, kind, proposal.projectId, request.id) : undefined;
        return { request, row: row ?? null };
      });
    }
    return { items };
  }

  const kind = KIND_BY_TOOL[proposal.tool];
  const id = proposal.input.id;
  const row = kind && typeof id === 'string' ? snapshot(db, kind, proposal.projectId, id) : undefined;
  if (!row) return { row: null };
  return { row };
}

function restoreInput(tool: string, request: Record<string, unknown>, row: Record<string, unknown>) {
  const fields = RESTORE_FIELDS[tool] ?? [];
  const restore = Object.fromEntries(fields.filter((key) => request[key] !== undefined && key in row)
    .map((key) => [key, row[key]]));
  if (tool === 'save_relationship') {
    if (request.from !== undefined && row.from !== undefined) restore.from = row.from;
    if (request.to !== undefined && row.to !== undefined) restore.to = row.to;
  }
  return restore;
}

function expectedValues(kind: KnowledgeKind | 'terms', row: Record<string, unknown>, fields: string[]) {
  const compared = kind === 'relationships' ? [...fields, 'fromId', 'toId'] : fields;
  return Object.fromEntries(compared.filter((field) => field in row)
    .map((field) => [field, row[field]]));
}

const TERM_FIELDS = ['source', 'target', 'note', 'status', 'origin'];

function expectation(kind: KnowledgeKind | 'terms', id: string, fields: string[], row: Record<string, unknown>) {
  return { kind, id, values: expectedValues(kind, row, fields) };
}

function knowledgeAfter(db: Db, proposal: Proposal, before: Capture, result: unknown): s.ProposalUndo {
  if (!isRecord(result) || result.ok !== true) return none('변경이 적용되지 않았습니다');
  if (proposal.tool !== 'save_knowledge') {
    const kind = KIND_BY_TOOL[proposal.tool];
    if (typeof proposal.input.id !== 'string') {
      return typeof result.id === 'string' && kind
        ? { calls: [call('delete_items', { kind, ids: [result.id] }, [expectation(kind, result.id,
          RESTORE_FIELDS[proposal.tool], snapshot(db, kind, proposal.projectId, result.id) ?? {})])] }
        : none('만든 항목 id를 확인하지 못했습니다');
    }
    const row = isRecord(before.row) ? before.row : null;
    if (!row) return none('수정 전 항목을 찾지 못했습니다');
    const touched = (RESTORE_FIELDS[proposal.tool] ?? []).filter((key) => proposal.input[key] !== undefined);
    const id = proposal.input.id;
    const current = typeof id === 'string' && kind ? snapshot(db, kind, proposal.projectId, id) : undefined;
    return { calls: [call(proposal.tool, {
      id: proposal.input.id, ...restoreInput(proposal.tool, proposal.input, row),
    }, kind && typeof id === 'string'
      ? [expectation(kind, id, touched, current ?? {})] : [])] };
  }

  const items = isRecord(before.items) ? before.items : {};
  const results = Array.isArray(result.results) ? result.results.filter(isRecord) : [];
  const saves: Record<string, Record<string, unknown>[]> = {};
  const deletes: Call[] = [];
  for (const [kind, tool] of Object.entries(TOOL_BY_KIND) as [KnowledgeKind, string][]) {
    const entries = Array.isArray(items[kind]) ? items[kind] as Capture[] : [];
    entries.forEach((entry, index) => {
      const saved = results.find((item) => item.kind === kind && item.index === index);
      if (!saved || saved.ok !== true || typeof saved.id !== 'string') return;
      const row = isRecord(entry.row) ? entry.row : null;
      const request = isRecord(entry.request) ? entry.request : {};
      if (typeof request.id === 'string' && row) {
        saves[kind] ??= [];
        saves[kind].push({ id: request.id, ...restoreInput(tool, request, row) });
      } else {
        const current = snapshot(db, kind, proposal.projectId, saved.id);
        deletes.push(call('delete_items', { kind, ids: [saved.id] }, [expectation(kind, saved.id,
          RESTORE_FIELDS[tool], current ?? {})]));
      }
    });
  }
  const calls = Object.keys(saves).length ? [call('save_knowledge', saves)] : [];
  if (calls.length) {
    calls[0].expect = (Object.keys(TOOL_BY_KIND) as KnowledgeKind[]).flatMap((kind) => {
      const entries = saves[kind] ?? [];
      const tool = TOOL_BY_KIND[kind];
      return entries.flatMap((entry) => {
        const id = entry.id;
        if (typeof id !== 'string') return [];
        const current = snapshot(db, kind, proposal.projectId, id);
        return [expectation(kind, id, RESTORE_FIELDS[tool].filter((field) => entry[field] !== undefined), current ?? {})];
      });
    });
  }
  return { calls: [...calls, ...deletes] };
}

type PreviousLine = {
  key: string; missing?: true; rev?: number; translation?: string; status?: string;
  tags?: string[]; listener?: string | null; touched?: string[];
};

function readLineTags(db: Db, unitId: string) {
  return db.select({ name: s.tags.name }).from(s.unitTags)
    .innerJoin(s.tags, eq(s.unitTags.tagId, s.tags.id))
    .where(eq(s.unitTags.unitId, unitId)).all().map((tag) => tag.name);
}

function captureLines(db: Db, proposal: Proposal): Capture {
  const changes = objectList(proposal.input.changes);
  const previous: PreviousLine[] = changes.map((change) => {
    const key = String(change.key ?? '');
    const unit = db.select().from(s.units)
      .where(and(eq(s.units.projectId, proposal.projectId), eq(s.units.key, key))).get();
    if (!unit) return { key, missing: true };
    const status = db.select({ name: s.statuses.name }).from(s.statuses)
      .where(eq(s.statuses.id, unit.statusId)).get()?.name;
    return {
      key, rev: unit.updatedAt.getTime(), translation: unit.translation ?? '', status, tags: readLineTags(db, unit.id),
      listener: unit.listener,
      touched: Object.keys(change).filter((field) =>
        ['translation', 'status', 'addTags', 'removeTags', 'listener'].includes(field)),
    };
  });
  return { previous, lineRevs: Object.fromEntries(previous.flatMap((line) =>
    typeof line.rev === 'number' ? [[line.key, line.rev]] : [])) };
}

function inverseLineChange(
  db: Db, proposal: Proposal, prior: PreviousLine,
): Record<string, unknown> | null {
  if (prior.missing) return null;
  const current = db.select().from(s.units)
    .where(and(eq(s.units.projectId, proposal.projectId), eq(s.units.key, prior.key))).get();
  if (!current) return null;
  const touched = new Set(prior.touched ?? []);
  const beforeTags = prior.tags ?? [];
  const nowTags = readLineTags(db, current.id);
  const addTags = beforeTags.filter((tag) => !nowTags.includes(tag));
  const removeTags = nowTags.filter((tag) => !beforeTags.includes(tag));
  const undo: Record<string, unknown> = { key: prior.key, rev: current.updatedAt.getTime() };
  if (touched.has('translation')) undo.translation = prior.translation ?? '';
  if (touched.has('status') && prior.status) undo.status = prior.status;
  if (touched.has('listener')) undo.listener = prior.listener ?? '';
  if (touched.has('addTags') || touched.has('removeTags')) {
    if (addTags.length) undo.addTags = addTags;
    if (removeTags.length) undo.removeTags = removeTags;
  }
  return undo;
}

function undoLines(db: Db, proposal: Proposal, before: Capture, result: unknown): s.ProposalUndo {
  const skipped = new Set(isRecord(result) && Array.isArray(result.skipped)
    ? result.skipped.filter(isRecord).map((item) => item.key) : []);
  const previous = Array.isArray(before.previous) ? before.previous as PreviousLine[] : [];
  const changes = previous.flatMap((prior) => {
    if (skipped.has(prior.key)) return [];
    const undo = inverseLineChange(db, proposal, prior);
    return undo ? [undo] : [];
  });
  const lineRevs = isRecord(before.lineRevs) ? Object.fromEntries(Object.entries(before.lineRevs)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {};
  return { calls: changes.length ? [call('propose_changes', { origin: 'human', changes })] : [], lineRevs };
}

function beforeTerms(db: Db, proposal: Proposal): Capture {
  const terms = objectList(proposal.input.terms).map((request) => {
    const row = typeof request.id === 'string'
      ? db.select().from(s.terms).where(and(eq(s.terms.id, request.id), eq(s.terms.projectId, proposal.projectId))).get()
      : undefined;
    return { request, row: row ? { ...row } : null };
  });
  return { terms };
}

function afterTerms(db: Db, proposal: Proposal, before: Capture, result: unknown): s.ProposalUndo {
  const output = isRecord(result) ? result : {};
  const previous = Array.isArray(before.terms) ? before.terms.filter(isRecord) : [];
  const requests = objectList(proposal.input.terms);
  const expectations: NonNullable<Call['expect']> = [];
  const restored = previous.flatMap((entry, index) => {
    const request = requests[index];
    if (!request || typeof request.id !== 'string' || !isRecord(entry.row)) return [];
    const row = entry.row;
    if (!isRecord(row)) return [];
    const values = Object.fromEntries(Object.keys(request).filter((key) => key in row)
      .map((key) => [key, row[key]]));
    const current = db.select().from(s.terms).where(and(eq(s.terms.projectId, proposal.projectId),
      eq(s.terms.id, request.id))).get();
    expectations.push(expectation('terms', request.id, Object.keys(values), current ? { ...current } : {}));
    return [{ id: request.id, ...values }];
  });
  const created = Array.isArray(output.created) ? output.created.filter((id): id is string => typeof id === 'string') : [];
  const calls: Call[] = [];
  if (restored.length) calls.push(call('save_terms', { terms: restored }, expectations));
  if (created.length) calls.push(call('delete_items', { kind: 'terms', ids: created }, created.flatMap((id) => {
    const current = db.select().from(s.terms).where(and(eq(s.terms.projectId, proposal.projectId),
      eq(s.terms.id, id))).get();
    return [expectation('terms', id, TERM_FIELDS, current ? { ...current } : {})];
  })));
  return { calls };
}

function beforeTags(db: Db, proposal: Proposal): Capture {
  const tags = db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags)
    .where(eq(s.tags.projectId, proposal.projectId)).all();
  const kind = proposal.input.kind;
  const ids = Array.isArray(proposal.input.ids) ? proposal.input.ids.filter((id): id is string => typeof id === 'string') : [];
  const links: Record<string, string[]> = {};
  const add = Array.isArray(proposal.input.add) ? proposal.input.add : [];
  const remove = Array.isArray(proposal.input.remove) ? proposal.input.remove : [];
  for (const ref of [...add, ...remove]) {
    if (typeof ref !== 'string') continue;
    const tag = tags.find((row) => row.id === ref || row.name === ref || row.name === ref.replace(/^#/, ''));
    if (!tag || typeof kind !== 'string') continue;
    const tagKind = kind as typeof s.knowledgeTags.$inferSelect.kind;
    links[tag.id] = db.select({ id: s.knowledgeTags.itemId }).from(s.knowledgeTags)
      .where(and(eq(s.knowledgeTags.kind, tagKind),
        eq(s.knowledgeTags.tagId, tag.id), inArray(s.knowledgeTags.itemId, ids))).all().map((row) => row.id);
  }
  return { tags, links, ids, kind };
}

function afterTags(_db: Db, proposal: Proposal, before: Capture): s.ProposalUndo {
  const tags = Array.isArray(before.tags) ? before.tags as { id: string; name: string }[] : [];
  const links = isRecord(before.links) ? before.links as Record<string, string[]> : {};
  const ids = Array.isArray(before.ids) ? before.ids as string[] : [];
  const inverse: Call[] = [];
  for (const [field, adding] of [['add', false], ['remove', true]] as const) {
    const refs = Array.isArray(proposal.input[field]) ? proposal.input[field] as unknown[] : [];
    for (const ref of refs) {
      if (typeof ref !== 'string') continue;
      const tag = tags.find((row) => row.id === ref || row.name === ref || row.name === ref.replace(/^#/, ''));
      if (!tag) continue;
      const had = new Set(links[tag.id] ?? []);
      const originalAdded = field === 'add';
      const changed = ids.filter((id) => originalAdded ? !had.has(id) : had.has(id));
      if (changed.length) inverse.push(call('tag_items', {
        kind: before.kind, ids: changed, add: adding ? [tag.name] : [], remove: adding ? [] : [tag.name],
      }));
    }
  }
  return { calls: inverse };
}

const INVERSES: Record<string, Inverse> = {
  propose_changes: { before: captureLines, after: undoLines },
  ...Object.fromEntries(Object.keys(RESTORE_FIELDS).map((tool) =>
    [tool, { before: knowledgeBefore, after: knowledgeAfter }])) as Record<string, Inverse>,
  save_knowledge: { before: knowledgeBefore, after: knowledgeAfter },
  save_terms: { before: beforeTerms, after: afterTerms },
  save_group_summary: {
    before: (db, proposal) => ({ description: db.select({ description: s.groups.description })
      .from(s.groups).where(and(eq(s.groups.id, String(proposal.input.groupId)),
        eq(s.groups.projectId, proposal.projectId))).get()?.description ?? '' }),
    after: (_db, proposal, before) => typeof before.description === 'string' && before.description
      ? { calls: [call('save_group_summary', { groupId: proposal.input.groupId, description: before.description })] }
      : none('이전 장면 요약이 비어 있어 복원할 수 없습니다'),
  },
  tag_items: { before: beforeTags, after: afterTags },
  save_status: {
    after: (_db, proposal, _before, result) => proposal.input.type === 'tag' && isRecord(result) && typeof result.id === 'string'
      ? { calls: [call('delete_items', { kind: 'tags', ids: [result.id] })] }
      : none('상태는 지울 수 없습니다'),
  },
  save_workflow: {
    before: (db, proposal) => ({ row: typeof proposal.input.id === 'string'
      ? db.select().from(s.workflows).where(and(eq(s.workflows.id, proposal.input.id),
        eq(s.workflows.projectId, proposal.projectId))).get() ?? null : null }),
    after: (_db, proposal, before) => isRecord(before.row)
      ? { calls: [call('save_workflow', {
        id: proposal.input.id, name: before.row.name, description: before.row.description,
        definition: before.row.definition,
      })] }
      : none('새 워크플로는 되돌릴 수 없습니다'),
  },
  update_project_settings: {
    before: (db, proposal) => {
      const settings = readProjectSettings(db, proposal.projectId);
      return { values: settings ? sent(settings as Record<string, unknown>, Object.keys(proposal.input)) : {} };
    },
    after: (_db, _proposal, before) => isRecord(before.values)
      ? { calls: [call('update_project_settings', before.values)] } : { calls: [] },
  },
  pull_app_defaults: { after: () => none('가져온 값은 홈 기본값으로 바뀌어 있어 되돌릴 수 없습니다') },
  propose_translation: { after: () => none('후보만 추가했고 현재 번역은 그대로입니다') },
  start_run: { after: () => none('실행 기록은 되돌릴 수 없습니다') },
  delete_items: { after: () => none('삭제된 항목은 되살릴 수 없습니다') },
};

/** Captures an inverse before the write, then builds it after; capture failures never block the write. */
export function captureUndo(db: Db, proposal: Proposal): (result: unknown) => s.ProposalUndo {
  const inverse = INVERSES[proposal.tool];
  if (!inverse) return () => none(NONE);
  let before: Capture = {};
  try {
    before = inverse.before?.(db, proposal) ?? {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return () => none(`되돌리기를 준비하지 못했습니다: ${reason}`);
  }
  return (result) => {
    try {
      return inverse.after(db, proposal, before, result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return none(`되돌리기를 준비하지 못했습니다: ${reason}`);
    }
  };
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return undefined;
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function matchesExpectation(db: Db, projectId: string, item: NonNullable<s.UndoCall['expect']>[number]) {
  const row = item.kind === 'terms'
    ? db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), eq(s.terms.id, item.id))).get()
    : snapshot(db, item.kind, projectId, item.id);
  if (!row) return false;
  const values: Record<string, unknown> = item.kind === 'terms' ? { ...row } : row;
  return Object.entries(item.values).every(([key, expected]) =>
    JSON.stringify(stableValue(values[key])) === JSON.stringify(stableValue(expected)));
}

/** Restores first, then deletes: relationships before characters, so no delete cascades into a row being kept. */
export function orderedCalls(calls: s.UndoCall[]) {
  const deleteRank = (call: s.UndoCall) => call.tool !== 'delete_items' ? 0
    : call.input.kind === 'relationships' ? 1 : call.input.kind === 'characters' ? 3 : 2;
  return [...calls].sort((left, right) => deleteRank(left) - deleteRank(right));
}

/**
 * The inverse without items a person changed since (they no longer hold the values the change left)
 * and without created characters a kept relationship still points to. Dropped ids are reported as skipped.
 */
export function dropConflicts(db: Db, projectId: string, call: s.UndoCall) {
  const expectations = call.expect ?? [];
  const conflicts = new Set(expectations.filter((item) => !matchesExpectation(db, projectId, item))
    .map((item) => item.id));
  const input = { ...call.input };
  if (call.tool === 'save_knowledge') {
    for (const kind of Object.keys(TOOL_BY_KIND) as KnowledgeKind[]) {
      if (!Array.isArray(input[kind])) continue;
      input[kind] = input[kind].filter((value) => !isRecord(value) || typeof value.id !== 'string' || !conflicts.has(value.id));
    }
    return { call: Object.values(input).some((value) => Array.isArray(value) && value.length)
      ? { ...call, input } : null, dropped: [...conflicts] };
  }
  if (call.tool === 'save_terms' && Array.isArray(input.terms)) {
    const terms = input.terms.filter((value) => !isRecord(value) || typeof value.id !== 'string' || !conflicts.has(value.id));
    input.terms = terms;
    return { call: terms.length ? { ...call, input } : null, dropped: [...conflicts] };
  }
  if (call.tool === 'delete_items' && Array.isArray(input.ids)) {
    const ids = input.ids.filter((id): id is string => typeof id === 'string' && !conflicts.has(id));
    const dropped = [...conflicts];
    // Relationship deletes run first (orderedCalls), so any relationship still here is one being kept
    // (a person's, or one whose delete was skipped): deleting its character would cascade into it.
    if (input.kind === 'characters') {
      for (const id of [...ids]) {
        const linked = db.select({ id: s.relationships.id }).from(s.relationships)
          .where(and(eq(s.relationships.projectId, projectId), or(eq(s.relationships.fromId, id), eq(s.relationships.toId, id)))).get();
        if (linked) {
          ids.splice(ids.indexOf(id), 1);
          dropped.push(id);
        }
      }
    }
    input.ids = ids;
    return { call: ids.length ? { ...call, input } : null, dropped };
  }
  // A single save restores one item.
  return conflicts.size ? { call: null, dropped: [...conflicts] } : { call, dropped: [] as string[] };
}

/** An older inverse checked against a line revision that a newer undo has since moved on. */
export function rebaseLineCall(call: s.UndoCall, rebased: Map<string, { before: number; now: number }>): s.UndoCall {
  if (call.tool !== 'propose_changes' || !Array.isArray(call.input.changes)) return call;
  const changes = call.input.changes.map((value) => {
    if (!isRecord(value) || typeof value.key !== 'string' || typeof value.rev !== 'number') return value;
    const known = rebased.get(value.key);
    return known && value.rev === known.before ? { ...value, rev: known.now } : value;
  });
  return { ...call, input: { ...call.input, changes } };
}

export function rememberLineRevisions(
  db: Db, original: typeof s.proposals.$inferSelect, call: s.UndoCall,
  result: unknown, rebased: Map<string, { before: number; now: number }>,
) {
  if (call.tool !== 'propose_changes' || !original.undo || !('calls' in original.undo)) return;
  const skipped = new Set(isRecord(result) && Array.isArray(result.skipped)
    ? result.skipped.flatMap((item) => isRecord(item) && typeof item.key === 'string' ? [item.key] : []) : []);
  const before = original.undo.lineRevs ?? {};
  const changes = Array.isArray(call.input.changes) ? call.input.changes : [];
  for (const value of changes) {
    if (!isRecord(value) || typeof value.key !== 'string' || skipped.has(value.key) ||
        typeof before[value.key] !== 'number') continue;
    const unit = db.select().from(s.units).where(and(eq(s.units.projectId, original.projectId),
      eq(s.units.key, value.key))).get();
    if (unit) rebased.set(value.key, { before: before[value.key], now: unit.updatedAt.getTime() });
  }
}
