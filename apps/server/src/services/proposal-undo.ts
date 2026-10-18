import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { readProjectSettings } from './project-settings.ts';

type Proposal = typeof s.proposals.$inferSelect;
type Call = { tool: string; input: Record<string, unknown> };
type Capture = Record<string, unknown>;
type KnowledgeKind = 'characters' | 'relationships' | 'speechRules' | 'events' | 'documents';
type KnowledgeRow = typeof s.characters.$inferSelect | typeof s.relationships.$inferSelect |
  typeof s.speechRules.$inferSelect | typeof s.storyEvents.$inferSelect | typeof s.documents.$inferSelect;
type Inverse = {
  before?: (db: Db, proposal: Proposal) => Capture;
  after: (db: Db, proposal: Proposal, before: Capture, result: unknown) => s.ProposalUndo;
};

const NONE = '이 변경은 되돌릴 수 없습니다';
const none = (reason: string): s.ProposalUndo => ({ none: reason });
const call = (tool: string, input: Record<string, unknown>): Call => ({ tool, input });
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
  save_character: ['name', 'role', 'aliases', 'profile', 'speech', 'style', 'gender', 'ageBand', 'player', 'status'],
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

function knowledgeBefore(db: Db, proposal: Proposal): Capture {
  if (proposal.tool === 'save_knowledge') {
    const items: Record<string, { request: Record<string, unknown>; row: Record<string, unknown> | null }[]> = {};
    for (const kind of Object.keys(TOOL_BY_KIND) as KnowledgeKind[]) {
      items[kind] = objectList(proposal.input[kind]).map((request) => {
        const row = typeof request.id === 'string'
          ? rowFor(db, kind, proposal.projectId, request.id)
          : undefined;
        return { request, row: row ? rowValues(row) : null };
      });
    }
    return { items };
  }

  const kind = KIND_BY_TOOL[proposal.tool];
  const id = proposal.input.id;
  const row = kind && typeof id === 'string' ? rowFor(db, kind, proposal.projectId, id) : undefined;
  if (!row) return { row: null };
  const values = rowValues(row);
  if (kind === 'relationships') {
    const fromId = values.fromId;
    const toId = values.toId;
    if (typeof fromId !== 'string' || typeof toId !== 'string') return { row: values };
    values.from = db.select({ name: s.characters.name }).from(s.characters)
      .where(eq(s.characters.id, fromId)).get()?.name;
    values.to = db.select({ name: s.characters.name }).from(s.characters)
      .where(eq(s.characters.id, toId)).get()?.name;
  }
  return { row: values };
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

function knowledgeAfter(_db: Db, proposal: Proposal, before: Capture, result: unknown): s.ProposalUndo {
  if (!isRecord(result) || result.ok !== true) return none('변경이 적용되지 않았습니다');
  if (proposal.tool !== 'save_knowledge') {
    const kind = KIND_BY_TOOL[proposal.tool];
    if (typeof proposal.input.id !== 'string') {
      return typeof result.id === 'string'
        ? { calls: [call('delete_items', { kind, ids: [result.id] })] }
        : none('만든 항목 id를 확인하지 못했습니다');
    }
    const row = isRecord(before.row) ? before.row : null;
    if (!row) return none('수정 전 항목을 찾지 못했습니다');
    return { calls: [call(proposal.tool, {
      id: proposal.input.id, ...restoreInput(proposal.tool, proposal.input, row),
    })] };
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
        deletes.push(call('delete_items', { kind, ids: [saved.id] }));
      }
    });
  }
  const calls = Object.keys(saves).length ? [call('save_knowledge', saves), ...deletes] : deletes;
  return { calls };
}

type PreviousLine = {
  key: string; missing?: true; translation?: string; status?: string;
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
      key, translation: unit.translation ?? '', status, tags: readLineTags(db, unit.id),
      listener: unit.listener,
      touched: Object.keys(change).filter((field) =>
        ['translation', 'status', 'addTags', 'removeTags', 'listener'].includes(field)),
    };
  });
  return { previous };
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
  return { calls: changes.length ? [call('propose_changes', { origin: 'human', changes })] : [] };
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

function afterTerms(_db: Db, proposal: Proposal, before: Capture, result: unknown): s.ProposalUndo {
  const output = isRecord(result) ? result : {};
  const previous = Array.isArray(before.terms) ? before.terms.filter(isRecord) : [];
  const requests = objectList(proposal.input.terms);
  const restored = previous.flatMap((entry, index) => {
    const request = requests[index];
    if (!request || typeof request.id !== 'string' || !isRecord(entry.row)) return [];
    const row = entry.row;
    if (!isRecord(row)) return [];
    const values = Object.fromEntries(Object.keys(request).filter((key) => key in row)
      .map((key) => [key, row[key]]));
    return [{ id: request.id, ...values }];
  });
  const created = Array.isArray(output.created) ? output.created.filter((id): id is string => typeof id === 'string') : [];
  const calls: Call[] = [];
  if (restored.length) calls.push(call('save_terms', { terms: restored }));
  if (created.length) calls.push(call('delete_items', { kind: 'terms', ids: created }));
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
