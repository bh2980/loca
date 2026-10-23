import { and, asc, desc, eq, inArray, ne, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { ATTACH_KINDS, ATTACH_PAGE, ATTACH_PER_KIND, CHARACTER_ROLE_LABELS, listenerLabel, SPEECH_LEVEL_LABELS, type AttachItem, type AttachKind, type AttachSearchResult } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { lineTextFilter } from './line-text.ts';

/**
 * The chat's @ search (docs/CHAT-INPUT-DESIGN.md 2): one query per kind, each limited in SQL (lines go
 * through the units_fts index, never loaded whole), matches ranked exact → prefix → contains → recent.
 * Without a kind it returns the top few of every kind; with one, a page of it.
 */
const esc = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);
type Col = AnyColumn | SQL;

interface Search {
  db: Db;
  projectId: string;
  q: string;
  limit: number;
  offset: number;
}

const likeOf = (column: Col, pattern: string) => sql`${column} like ${pattern} escape '\\'`;
/** A row matches when any of the columns contains the text; no text matches everything. */
const matching = (q: string, columns: Col[]): SQL | undefined => (q ? or(...columns.map((column) => likeOf(column, `%${esc(q)}%`))) : undefined);
/** 0 exact, 1 prefix, 2 contains in a name column, 3 matched elsewhere (aliases, notes, text). */
function rank(q: string, names: Col[]): SQL {
  // Not a bare number: ORDER BY 0 would be read as a column position.
  if (!q) return sql`abs(0)`;
  const any = (test: (column: Col) => SQL) => sql.join(names.map(test), sql` or `);
  return sql`case when ${any((column) => sql`lower(coalesce(${column}, '')) = ${q.toLowerCase()}`)} then 0 when ${any((column) => likeOf(sql`coalesce(${column}, '')`, `${esc(q)}%`))} then 1 when ${any((column) => likeOf(sql`coalesce(${column}, '')`, `%${esc(q)}%`))} then 2 else 3 end`;
}

const clip = (text: string, length: number) => (text.length > length ? `${text.slice(0, length)}…` : text);
const one = (text: string) => text.replace(/\s+/g, ' ').trim();
const path = (projectId: string, page: string, search: Record<string, string | boolean>) => {
  const query = Object.entries(search).map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&');
  return `/p/${projectId}/${page}${query ? `?${query}` : ''}`;
};
const json = (ids: string[]) => JSON.stringify(ids);

const DOCUMENT_KIND_LABELS = { story: '스토리', world: '세계관', style: '문체', note: '메모' } as const;
const RUN_STATUS_LABELS = { running: '진행 중', paused: '일시중지', cancelled: '취소됨', completed: '완료' } as const;
const two = (value: number) => String(value).padStart(2, '0');
/** "10/23 11:02": when a run started, in the server's (the person's) local time. */
export const runStamp = (at: Date) => `${two(at.getMonth() + 1)}/${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;

type Finder = (search: Search) => AttachItem[];

const finders: Record<AttachKind, Finder> = {
  대사: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.units.id, key: s.units.key, groupId: s.units.groupId, speaker: s.units.speaker, source: s.units.source })
      .from(s.units)
      .where(and(eq(s.units.projectId, projectId), q ? lineTextFilter(q) : undefined))
      // A key that is the text is the line asked for; otherwise script order (empty: what was edited last).
      .orderBy(...(q ? [asc(rank(q, [s.units.key])), asc(s.units.seq)] : [desc(s.units.updatedAt)]))
      .limit(limit)
      .offset(offset)
      .all()
      .map((line) => ({ kind: '대사', id: line.id, label: `${line.speaker?.trim() ? `${line.speaker.trim()}: ` : ''}${clip(one(line.source), 40)}`, detail: line.key, href: path(projectId, 'script', { group: line.groupId, line: line.id, detail: true }) })),

  장면: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.groups.id, title: s.groups.title, section: s.groups.section, lines: sql<number>`(select count(*) from units where units.group_id = groups.id)` })
      .from(s.groups)
      .where(and(eq(s.groups.projectId, projectId), eq(s.groups.kind, 'scene'), matching(q, [s.groups.title, s.groups.key])))
      .orderBy(asc(rank(q, [s.groups.title, s.groups.key])), asc(s.groups.sort))
      .limit(limit)
      .offset(offset)
      .all()
      .map((scene) => ({ kind: '장면', id: scene.id, label: scene.title, detail: `${scene.section ? `${scene.section} · ` : ''}${scene.lines.toLocaleString()}줄`, href: path(projectId, 'script', { group: scene.id }) })),

  인물: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases, role: s.characters.role })
      .from(s.characters)
      .where(and(eq(s.characters.projectId, projectId), ne(s.characters.status, 'rejected'), matching(q, [s.characters.name, s.characters.aliases])))
      .orderBy(asc(rank(q, [s.characters.name])), desc(s.characters.updatedAt))
      .limit(limit)
      .offset(offset)
      .all()
      .map((person) => ({ kind: '인물', id: person.id, label: person.name, detail: [person.role === 'unknown' ? '' : CHARACTER_ROLE_LABELS[person.role], person.aliases.length ? `별칭 ${person.aliases.join(', ')}` : ''].filter(Boolean).join(' · ') || undefined, href: path(projectId, 'knowledge', { tab: 'people', display: 'characters', item: person.id }) })),

  관계: ({ db, projectId, q, limit, offset }) => {
    const from = alias(s.characters, 'from_character');
    const to = alias(s.characters, 'to_character');
    return db
      .select({ id: s.relationships.id, from: from.name, to: to.name, kind: s.relationships.kind, changes: s.relationships.changes })
      .from(s.relationships)
      .innerJoin(from, eq(from.id, s.relationships.fromId))
      .innerJoin(to, eq(to.id, s.relationships.toId))
      .where(and(eq(s.relationships.projectId, projectId), ne(s.relationships.status, 'rejected'), matching(q, [from.name, to.name, s.relationships.kind])))
      .orderBy(asc(rank(q, [from.name, to.name])), asc(from.name), asc(to.name))
      .limit(limit)
      .offset(offset)
      .all()
      .map((row) => ({ kind: '관계', id: row.id, label: `${row.from} → ${row.to}`, detail: row.changes.length ? `${row.kind} ▸ ${row.changes.at(-1)!.kind}` : row.kind, href: path(projectId, 'knowledge', { tab: 'people', item: row.id }) }));
  },

  '말투 규칙': ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.speechRules.id, from: s.speechRules.fromName, to: s.speechRules.toName, level: s.speechRules.level, address: s.speechRules.address })
      .from(s.speechRules)
      .where(and(eq(s.speechRules.projectId, projectId), ne(s.speechRules.status, 'rejected'), matching(q, [s.speechRules.fromName, s.speechRules.toName])))
      .orderBy(asc(rank(q, [s.speechRules.fromName, s.speechRules.toName])), desc(s.speechRules.updatedAt))
      .limit(limit)
      .offset(offset)
      .all()
      .map((rule) => ({ kind: '말투 규칙', id: rule.id, label: `${rule.from} → ${listenerLabel(rule.to)}`, detail: SPEECH_LEVEL_LABELS[rule.level] + (rule.address ? ` · ${rule.address}` : ''), href: path(projectId, 'knowledge', { tab: 'people', item: rule.id }) })),

  사건: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.storyEvents.id, title: s.storyEvents.title, participants: s.storyEvents.participants })
      .from(s.storyEvents)
      .where(and(eq(s.storyEvents.projectId, projectId), ne(s.storyEvents.status, 'rejected'), matching(q, [s.storyEvents.title, s.storyEvents.participants])))
      .orderBy(asc(rank(q, [s.storyEvents.title])), desc(s.storyEvents.updatedAt))
      .limit(limit)
      .offset(offset)
      .all()
      .map((event) => ({ kind: '사건', id: event.id, label: event.title, detail: event.participants.join(', ') || undefined, href: path(projectId, 'knowledge', { tab: 'events', item: event.id }) })),

  노트: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.documents.id, title: s.documents.title, kind: s.documents.kind })
      .from(s.documents)
      .where(and(eq(s.documents.projectId, projectId), ne(s.documents.status, 'rejected'), matching(q, [s.documents.title])))
      .orderBy(asc(rank(q, [s.documents.title])), desc(s.documents.updatedAt))
      .limit(limit)
      .offset(offset)
      .all()
      .map((note) => ({ kind: '노트', id: note.id, label: note.title, detail: DOCUMENT_KIND_LABELS[note.kind], href: path(projectId, 'knowledge', { tab: 'documents', item: note.id }) })),

  용어: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.terms.id, source: s.terms.source, target: s.terms.target, note: s.terms.note })
      .from(s.terms)
      .where(and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'), matching(q, [s.terms.source, s.terms.target])))
      .orderBy(asc(rank(q, [s.terms.source, s.terms.target])), desc(s.terms.updatedAt))
      .limit(limit)
      .offset(offset)
      .all()
      .map((term) => ({ kind: '용어', id: term.id, label: term.target ? `${term.source} → ${term.target}` : term.source, detail: term.note ? clip(one(term.note), 60) : undefined, href: path(projectId, 'glossary', { term: term.id }) })),

  태그: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.tags.id, name: s.tags.name, lines: sql<number>`(select count(*) from unit_tags where unit_tags.tag_id = tags.id)` })
      .from(s.tags)
      .where(and(eq(s.tags.projectId, projectId), matching(q, [s.tags.name])))
      .orderBy(asc(rank(q, [s.tags.name])), asc(s.tags.sort), asc(s.tags.name))
      .limit(limit)
      .offset(offset)
      .all()
      .map((tag) => ({ kind: '태그', id: tag.id, label: `#${tag.name}`, detail: `${tag.lines.toLocaleString()}줄`, href: path(projectId, 'script', { tags: json([tag.id]) }) })),

  상태: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.statuses.id, name: s.statuses.name, lines: sql<number>`(select count(*) from units where units.status_id = statuses.id)` })
      .from(s.statuses)
      .where(and(eq(s.statuses.projectId, projectId), matching(q, [s.statuses.name])))
      .orderBy(asc(rank(q, [s.statuses.name])), asc(s.statuses.sort))
      .limit(limit)
      .offset(offset)
      .all()
      .map((status) => ({ kind: '상태', id: status.id, label: status.name, detail: `${status.lines.toLocaleString()}줄`, href: path(projectId, 'script', { statuses: json([status.id]) }) })),

  워크플로: ({ db, projectId, q, limit, offset }) =>
    db
      .select({ id: s.workflows.id, name: s.workflows.name, description: s.workflows.description })
      .from(s.workflows)
      .where(and(eq(s.workflows.projectId, projectId), matching(q, [s.workflows.name, s.workflows.description])))
      .orderBy(asc(rank(q, [s.workflows.name])), asc(s.workflows.name))
      .limit(limit)
      .offset(offset)
      .all()
      .map((workflow) => ({ kind: '워크플로', id: workflow.id, label: workflow.name, detail: workflow.description ? clip(one(workflow.description), 60) : undefined, href: path(projectId, `workflows/${workflow.id}`, {}) })),

  '실행 기록': ({ db, projectId, q, limit, offset }) => {
    // The newest runs only: a run list is short, and the date is made here, not stored.
    const runs = db
      .select({ id: s.runs.id, name: s.runs.workflowName, status: s.runs.status, createdAt: s.runs.createdAt })
      .from(s.runs)
      .where(eq(s.runs.projectId, projectId))
      .orderBy(desc(s.runs.createdAt))
      .limit(200)
      .all()
      .map((run) => ({ ...run, label: `${runStamp(run.createdAt)} · ${run.name}` }));
    const needle = q.toLowerCase();
    const score = (run: (typeof runs)[number]) => (run.name.toLowerCase() === needle ? 0 : run.name.toLowerCase().startsWith(needle) ? 1 : run.label.toLowerCase().includes(needle) ? 2 : 3);
    const hits = (needle ? runs.filter((run) => run.label.toLowerCase().includes(needle)) : runs).map((run, index) => ({ run, index })).sort((a, b) => score(a.run) - score(b.run) || a.index - b.index).slice(offset, offset + limit).map((entry) => entry.run);
    if (!hits.length) return [];
    const failed = new Map(db.select({ runId: s.runItems.runId, count: sql<number>`count(*)` }).from(s.runItems).where(and(inArray(s.runItems.runId, hits.map((run) => run.id)), eq(s.runItems.state, 'failed'))).groupBy(s.runItems.runId).all().map((row) => [row.runId, row.count]));
    return hits.map((run) => ({ kind: '실행 기록', id: run.id, label: run.label, detail: `${RUN_STATUS_LABELS[run.status]}${failed.get(run.id) ? ` · 실패 ${failed.get(run.id)!.toLocaleString()}` : ''}`, href: path(projectId, `runs/${run.id}`, {}) }));
  },
};

/**
 * @-attach search. `kind` unset: the top ATTACH_PER_KIND of every kind that has a match (`more` = there
 * are further ones). `kind` set: one page of that kind (`limit` ≤ ATTACH_PAGE).
 */
export function searchAttach(db: Db, projectId: string, input: { q?: string; kind?: AttachKind; offset?: number; limit?: number }): AttachSearchResult {
  const q = (input.q ?? '').trim();
  const offset = Math.max(0, input.offset ?? 0);
  const find = (kind: AttachKind, limit: number, from: number) => {
    // One more than asked for says whether another page exists.
    const rows = finders[kind]({ db, projectId, q, limit: limit + 1, offset: from });
    return { kind, items: rows.slice(0, limit), more: rows.length > limit };
  };
  if (input.kind) return { groups: [find(input.kind, Math.min(input.limit ?? ATTACH_PAGE, ATTACH_PAGE), offset)] };
  return { groups: ATTACH_KINDS.map((kind) => find(kind, ATTACH_PER_KIND, 0)).filter((group) => group.items.length) };
}
