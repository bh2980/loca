import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { KnowledgeKind } from '../db/schema.ts';
import { revOf } from '../domain/line-save.ts';

type Proposal = typeof s.proposals.$inferSelect;
type Call = s.UndoCall;
type Capture = Record<string, unknown>;
type KnowledgeRow = typeof s.characters.$inferSelect | typeof s.relationships.$inferSelect |
  typeof s.speechRules.$inferSelect | typeof s.storyEvents.$inferSelect | typeof s.documents.$inferSelect;
/**
 * How an accepted change of one tool is put back (a tool definition's `undo` member, agent-tools.ts):
 * `before` reads what the change is about to overwrite, `after` turns that and the tool's result into
 * the calls that restore it.
 *
 * The rest says how the tool behaves when it is itself called as such a restoring call, so the undo
 * (change-gate.ts, undoChanges) knows no tool by name. `trim`: its input without the items a person changed
 * since (`conflicts`, by id), or null when nothing is left. `order`: where its call goes among the calls
 * that undo one change (lowest first; 0 when unset). `chain`: for a tool whose restoring calls depend on
 * each other across the changes undone in one request: `rebase` rewrites a call's input from what the
 * earlier ones left in `seen`, `remember` notes what this one left.
 */
export type Inverse = {
  before?: (db: Db, proposal: Proposal) => Capture;
  after: (db: Db, proposal: Proposal, before: Capture, result: unknown) => s.ProposalUndo;
  trim?: (db: Db, projectId: string, input: Record<string, unknown>, conflicts: Set<string>) => { input: Record<string, unknown> | null; dropped: string[] };
  order?: (input: Record<string, unknown>) => number;
  chain?: {
    rebase: (input: Record<string, unknown>, seen: Map<string, unknown>) => Record<string, unknown>;
    remember: (db: Db, original: Proposal, input: Record<string, unknown>, result: unknown, seen: Map<string, unknown>) => void;
  };
};

const NONE = '이 변경은 되돌릴 수 없습니다';
const none = (reason: string): s.ProposalUndo => ({ none: reason });
/** A change that is not put back, with why. */
export const noUndo = (reason: string): Inverse => ({ after: () => none(reason) });
export const undoCall = (tool: string, input: Record<string, unknown>, expect?: Call['expect']): Call => ({ tool, input, expect });
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const objectList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const KNOWLEDGE_KINDS: KnowledgeKind[] = ['characters', 'relationships', 'speechRules', 'events', 'documents'];
const RESTORE_FIELDS: Record<KnowledgeKind, string[]> = {
  characters: ['name', 'role', 'aliases', 'profile', 'speech', 'style', 'gender', 'ageBand', 'player', 'color', 'status'],
  relationships: ['kind', 'description', 'mutual', 'changes', 'status'],
  speechRules: ['fromName', 'toName', 'level', 'address', 'note', 'startKey', 'evidence', 'status'],
  events: ['title', 'summary', 'cause', 'outcome', 'participants', 'evidence', 'status'],
  documents: ['kind', 'title', 'body', 'alwaysInclude', 'status'],
};

/** The values of `input` for the named fields it has. */
export function sentValues(input: Record<string, unknown>, fields: string[]) {
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

function restoreInput(kind: KnowledgeKind, request: Record<string, unknown>, row: Record<string, unknown>) {
  const restore = Object.fromEntries(RESTORE_FIELDS[kind].filter((key) => request[key] !== undefined && key in row)
    .map((key) => [key, row[key]]));
  if (kind === 'relationships') {
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

/** One knowledge item's save: a new item is deleted again, an edited one gets its sent fields back. */
export const knowledgeUndo = (kind: KnowledgeKind): Inverse => ({
  before: (db, proposal) => {
    const id = proposal.input.id;
    return { row: (typeof id === 'string' ? snapshot(db, kind, proposal.projectId, id) : undefined) ?? null };
  },
  after: (db, proposal, before, result) => {
    if (!isRecord(result) || result.ok !== true) return none('변경이 적용되지 않았습니다');
    if (typeof proposal.input.id !== 'string') {
      return typeof result.id === 'string'
        ? { calls: [undoCall('delete_items', { kind, ids: [result.id] }, [expectation(kind, result.id,
          RESTORE_FIELDS[kind], snapshot(db, kind, proposal.projectId, result.id) ?? {})])] }
        : none('만든 항목 id를 확인하지 못했습니다');
    }
    const row = isRecord(before.row) ? before.row : null;
    if (!row) return none('수정 전 항목을 찾지 못했습니다');
    const touched = RESTORE_FIELDS[kind].filter((key) => proposal.input[key] !== undefined);
    const id = proposal.input.id;
    const current = snapshot(db, kind, proposal.projectId, id);
    return { calls: [undoCall(proposal.tool, { id, ...restoreInput(kind, proposal.input, row) }, [expectation(kind, id, touched, current ?? {})])] };
  },
});

/** A batch of knowledge saves: the edited items go back in one batch, the new ones are deleted. */
export const knowledgeBatchUndo: Inverse = {
  before: (db, proposal) => {
    const items: Record<string, { request: Record<string, unknown>; row: Record<string, unknown> | null }[]> = {};
    for (const kind of KNOWLEDGE_KINDS) {
      items[kind] = objectList(proposal.input[kind]).map((request) => {
        const row = typeof request.id === 'string'
          ? snapshot(db, kind, proposal.projectId, request.id) : undefined;
        return { request, row: row ?? null };
      });
    }
    return { items };
  },
  after: (db, proposal, before, result) => {
    if (!isRecord(result) || result.ok !== true) return none('변경이 적용되지 않았습니다');
    const items = isRecord(before.items) ? before.items : {};
    const results = Array.isArray(result.results) ? result.results.filter(isRecord) : [];
    const saves: Record<string, Record<string, unknown>[]> = {};
    const deletes: Call[] = [];
    for (const kind of KNOWLEDGE_KINDS) {
      const entries = Array.isArray(items[kind]) ? items[kind] as Capture[] : [];
      entries.forEach((entry, index) => {
        const saved = results.find((item) => item.kind === kind && item.index === index);
        if (!saved || saved.ok !== true || typeof saved.id !== 'string') return;
        const row = isRecord(entry.row) ? entry.row : null;
        const request = isRecord(entry.request) ? entry.request : {};
        if (typeof request.id === 'string' && row) {
          saves[kind] ??= [];
          saves[kind].push({ id: request.id, ...restoreInput(kind, request, row) });
        } else {
          const current = snapshot(db, kind, proposal.projectId, saved.id);
          deletes.push(undoCall('delete_items', { kind, ids: [saved.id] }, [expectation(kind, saved.id,
            RESTORE_FIELDS[kind], current ?? {})]));
        }
      });
    }
    const calls = Object.keys(saves).length ? [undoCall(proposal.tool, saves)] : [];
    if (calls.length) {
      calls[0].expect = KNOWLEDGE_KINDS.flatMap((kind) => {
        const entries = saves[kind] ?? [];
        return entries.flatMap((entry) => {
          const id = entry.id;
          if (typeof id !== 'string') return [];
          const current = snapshot(db, kind, proposal.projectId, id);
          return [expectation(kind, id, RESTORE_FIELDS[kind].filter((field) => entry[field] !== undefined), current ?? {})];
        });
      });
    }
    return { calls: [...calls, ...deletes] };
  },
  trim: (_db, _projectId, call, conflicts) => {
    const input = { ...call };
    for (const kind of KNOWLEDGE_KINDS) {
      if (!Array.isArray(input[kind])) continue;
      input[kind] = input[kind].filter((value) => !isRecord(value) || typeof value.id !== 'string' || !conflicts.has(value.id));
    }
    return { input: Object.values(input).some((value) => Array.isArray(value) && value.length) ? input : null, dropped: [...conflicts] };
  },
};

type PreviousLine = {
  key: string; missing?: true; rev?: number; translation?: string; status?: string;
  tags?: string[]; listener?: string | null; translate?: string | null; memo?: string; touched?: string[];
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
      key, rev: revOf(unit), translation: unit.translation ?? '', status, tags: readLineTags(db, unit.id),
      listener: unit.listener, translate: unit.translate, memo: unit.note,
      touched: Object.keys(change).filter((field) =>
        ['translation', 'status', 'addTags', 'removeTags', 'listener', 'translate', 'memo'].includes(field)),
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
  const undo: Record<string, unknown> = { key: prior.key, rev: revOf(current) };
  if (touched.has('translation')) undo.translation = prior.translation ?? '';
  if (touched.has('status') && prior.status) undo.status = prior.status;
  // A listener the change left as it was (an AI's never replaces a person's) is not written back.
  if (touched.has('listener') && (current.listener ?? null) !== (prior.listener ?? null)) undo.listener = prior.listener ?? '';
  if (touched.has('translate')) undo.translate = prior.translate ?? null;
  if (touched.has('memo')) undo.memo = prior.memo ?? '';
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
  return { calls: changes.length ? [undoCall(proposal.tool, { origin: 'human', changes })] : [], lineRevs };
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
  if (restored.length) calls.push(undoCall(proposal.tool, { terms: restored }, expectations));
  if (created.length) calls.push(undoCall('delete_items', { kind: 'terms', ids: created }, created.flatMap((id) => {
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
      if (changed.length) inverse.push(undoCall(proposal.tool, {
        kind: before.kind, ids: changed, add: adding ? [tag.name] : [], remove: adding ? [] : [tag.name],
      }));
    }
  }
  return { calls: inverse };
}

/** A line's rev as an undone change left it (`before`) and as the undo made it (`now`), by key. */
type MovedRev = { before: number; now: number };

/**
 * A batch of line changes: the lines it changed get their former text, status, tags, listener, memo and 번역 제외 back.
 * Undoing several changes of one line in one request, each restoring call was written against the rev its own change
 * left: an older one is checked against the rev the newer undo has since moved the line to (chain).
 */
export const lineChangesUndo: Inverse = {
  before: captureLines,
  after: undoLines,
  chain: {
    rebase: (input, seen) => {
      if (!Array.isArray(input.changes)) return input;
      const changes = input.changes.map((value) => {
        if (!isRecord(value) || typeof value.key !== 'string' || typeof value.rev !== 'number') return value;
        const known = seen.get(value.key) as MovedRev | undefined;
        return known && value.rev === known.before ? { ...value, rev: known.now } : value;
      });
      return { ...input, changes };
    },
    remember: (db, original, input, result, seen) => {
      if (!original.undo || !('calls' in original.undo)) return;
      const skipped = new Set(isRecord(result) && Array.isArray(result.skipped) ? result.skipped.flatMap((item) => (isRecord(item) && typeof item.key === 'string' ? [item.key] : [])) : []);
      const before = original.undo.lineRevs ?? {};
      for (const value of Array.isArray(input.changes) ? input.changes : []) {
        if (!isRecord(value) || typeof value.key !== 'string' || skipped.has(value.key) || typeof before[value.key] !== 'number') continue;
        const unit = db.select().from(s.units).where(and(eq(s.units.projectId, original.projectId), eq(s.units.key, value.key))).get();
        if (unit) seen.set(value.key, { before: before[value.key]!, now: revOf(unit) } satisfies MovedRev);
      }
    },
  },
};

/** Saved terms: edited ones get their sent fields back, new ones are deleted. */
export const termsUndo: Inverse = {
  before: beforeTerms,
  after: afterTerms,
  trim: (_db, _projectId, input, conflicts) => {
    const terms = Array.isArray(input.terms) ? input.terms.filter((value) => !isRecord(value) || typeof value.id !== 'string' || !conflicts.has(value.id)) : [];
    return { input: terms.length ? { ...input, terms } : null, dropped: [...conflicts] };
  },
};

/** Tags put on or taken off items: only the links the change made or removed are turned back. */
export const tagItemsUndo: Inverse = { before: beforeTags, after: afterTags };

/**
 * A change that recorded what it did as it ran (undo-records.ts: a delete, an edit of the dialogue graph) is put back
 * whole by that record: the tool answered with the record's id (undoId), and restore_deleted takes it. `kind`: what
 * was changed, as restore_deleted names it.
 */
export const undoesRecord = (kind: (input: Record<string, unknown>) => string): Inverse => ({
  after: (_db, proposal, _before, result) =>
    isRecord(result) && typeof result.undoId === 'string' ? { calls: [undoCall('restore_deleted', { kind: kind(proposal.input), id: result.undoId })] } : none('바뀐 것이 없어 되돌릴 것이 없습니다'),
});

/**
 * A delete of items by kind, called to undo a creation: it goes after the calls that restore (0), relationships before
 * the rest and characters last, so no delete cascades into a row being kept.
 */
export const deleteItemsOrder: NonNullable<Inverse['order']> = (input) => (input.kind === 'relationships' ? 1 : input.kind === 'characters' ? 3 : 2);

/** The same delete leaves what a person changed since, and characters a kept relationship points to. */
export const deleteItemsTrim: NonNullable<Inverse['trim']> = (db, projectId, input, conflicts) => {
  const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string' && !conflicts.has(id)) : [];
  const dropped = [...conflicts];
  // Relationship deletes run first (deleteItemsOrder), so any relationship still here is one being kept
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
  return { input: ids.length ? { ...input, ids } : null, dropped };
};

/** Captures an inverse before the write, then builds it after; capture failures never block the write. */
export function captureUndo(db: Db, proposal: Proposal, inverse: Inverse | undefined): (result: unknown) => s.ProposalUndo {
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

/** The calls that undo one change, in the order their tools ask for (`order`; a stable sort, so the rest stay as written). */
export function orderedCalls(calls: s.UndoCall[], inverseOf: (tool: string) => Inverse | undefined) {
  const rank = (call: s.UndoCall) => inverseOf(call.tool)?.order?.(call.input) ?? 0;
  return [...calls].sort((left, right) => rank(left) - rank(right));
}

/**
 * The inverse without items a person changed since (they no longer hold the values the change left);
 * `trim` is the called tool's own way to leave them out of its input (a single save restores one item,
 * so a conflict drops the call). Dropped ids are reported as skipped.
 */
export function dropConflicts(db: Db, projectId: string, call: s.UndoCall, trim: Inverse['trim']) {
  const conflicts = new Set((call.expect ?? []).filter((item) => !matchesExpectation(db, projectId, item)).map((item) => item.id));
  if (!trim) return conflicts.size ? { call: null, dropped: [...conflicts] } : { call, dropped: [] as string[] };
  const trimmed = trim(db, projectId, call.input, conflicts);
  return { call: trimmed.input ? { ...call, input: trimmed.input } : null, dropped: trimmed.dropped };
}
