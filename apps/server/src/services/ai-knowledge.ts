import { and, eq } from 'drizzle-orm';
import { AGE_BANDS, aiStatus, CHARACTER_ROLES, DOCUMENT_KINDS, GENDERS, isSpecialListener, SPEECH_LEVEL_LABELS, SPEECH_LEVELS, TERM_KIND_LABELS, TERM_KINDS } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { markForReview } from './knowledge-tags.ts';
import { clampConfidence, cleanListener, setAiListener } from './listeners.ts';
import { knownListener } from './speech.ts';
import { upsertAiTerm } from './terms.ts';

/**
 * What an AI result does to the project's knowledge and listeners. One home for the rules of the
 * 반영 nodes written straight into the project (engine/functions/apply.ts) and for `set_listeners`
 * (the chat/CLI tool and an accepted proposal): AI-made items land as AI › 사용 방식 says, nothing a
 * person made, edited, confirmed or rejected is changed, and a view that differs from a person's is
 * kept beside it as a candidate. Everything runs in the caller's transaction.
 */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export interface AiWrite {
  projectId: string;
  /** The workflow run that produced it (terms record it). */
  runId?: string;
  /** The project's AI 문맥 switch (aiAutoConfirmOf): confirmed right away, or candidates. */
  autoConfirm: boolean;
}

const lower = (value: string) => value.trim().toLowerCase();
const same = (a: string, b: string) => lower(a) === lower(b);
const namesOf = (c: { name: string; aliases: string[] }) => [c.name, ...c.aliases];
const pick = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => (values.includes(value as T) ? (value as T) : fallback);
const draft = (write: AiWrite) => ({ status: aiStatus(write.autoConfirm), statusBy: 'ai' as const, origin: 'ai' as const });
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim()) : []);

/** Speaker → listener pairs covering this share of dialogue lines are "main pairs": their rules wait for a person's look. */
export const MAIN_PAIR_SHARE = 0.8;

/** Lower-cased stored person name for any of their names or aliases (else the name itself). */
function personKey(people: { name: string; aliases: string[] }[]) {
  const map = new Map<string, string>();
  for (const p of people) for (const name of namesOf(p)) map.set(lower(name), lower(p.name));
  return (name: string) => map.get(lower(name)) ?? lower(name);
}

/**
 * Lower-cased spellings → a stored person's name, for people (found by AI) who are stored people under
 * another spelling: a shared name or alias, or the stored single-word name as a whole word of theirs
 * ("Mara" in "Mara Holt"). A word that fits several stored people maps to none.
 */
export function canonicalNames(stored: { name: string; aliases: string[] }[], found: { name: string; aliases: string[] }[]) {
  const byName = new Map<string, string>();
  for (const person of stored) for (const name of [person.name, ...person.aliases]) byName.set(lower(name), person.name);
  const map = new Map<string, string>(byName);
  for (const person of found) {
    const names = [person.name, ...person.aliases].map(lower);
    let match = names.map((name) => byName.get(name)).find(Boolean);
    if (!match) {
      const words = new Set(names.flatMap((name) => name.split(/[\s_.-]+/)));
      const hits = stored.filter((candidate) => [candidate.name, ...candidate.aliases].some((name) => !/\s/.test(name.trim()) && words.has(lower(name))));
      if (hits.length === 1) match = hits[0].name;
    }
    if (match) for (const name of names) map.set(name, match);
  }
  return map;
}

/** The speaker → listener pairs (stored-person keys) that together cover MAIN_PAIR_SHARE of dialogue lines with a known listener. */
export function mainPairs(tx: Tx | Db, projectId: string, people: { name: string; aliases: string[] }[]) {
  const person = personKey(people);
  const lines = tx.select({ speaker: s.units.speaker, listener: s.units.listener, origin: s.units.listenerOrigin, confidence: s.units.listenerConfidence }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.kind, 'dialogue'))).all();
  const counts = new Map<string, number>();
  for (const line of lines) {
    const listener = knownListener({ listener: line.listener, listenerOrigin: line.origin, listenerConfidence: line.confidence });
    if (!line.speaker || !listener || listener === 'group' || listener === 'self') continue;
    const key = `${person(line.speaker)}|${person(listener)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const main = new Set<string>();
  let covered = 0;
  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (covered >= total * MAIN_PAIR_SHARE) break;
    main.add(key);
    covered += count;
  }
  return main;
}

/** The stored cast (rejected ones kept apart): who a name means, as every AI write below resolves names. */
function cast(tx: Tx, projectId: string, found: { name: string; aliases: string[] }[] = []) {
  const stored = tx.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases, status: s.characters.status, profile: s.characters.profile, speech: s.characters.speech, gender: s.characters.gender, ageBand: s.characters.ageBand, role: s.characters.role, origin: s.characters.origin, evidence: s.characters.evidence }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
  const live = stored.filter((c) => c.status !== 'rejected');
  // The model may spell a known person differently ("Mara Holt" for the speaker "Mara"): mapped onto the stored person.
  const canonical = canonicalNames(live, found);
  const canon = (name: string) => canonical.get(lower(name)) ?? name;
  const idByName = new Map<string, string>();
  for (const c of live) for (const name of namesOf(c)) idByName.set(lower(name), c.id);
  return { stored, live, canon, idByName };
}

export interface AiTermItem { source: string; target?: string; note?: string; kind?: string; meaning?: string; evidence?: string[] }
/** Glossary terms: a known source keeps what it has (only empty fields are filled), a rejected one stays rejected. */
export function aiSaveTerms(tx: Tx, write: AiWrite, items: AiTermItem[]) {
  const counts = { added: 0, filled: 0, unchanged: 0 };
  for (const item of items) {
    if (!item.source?.trim()) continue;
    const kind = TERM_KINDS.includes(item.kind as (typeof TERM_KINDS)[number]) ? TERM_KIND_LABELS[item.kind as (typeof TERM_KINDS)[number]] : '';
    const note = [kind, item.meaning?.trim(), item.note?.trim()].filter(Boolean).join(' · ');
    const result = upsertAiTerm(tx, write.projectId, { source: item.source, target: item.target, note, examples: (item.evidence ?? []).slice(0, 3) }, { autoConfirm: write.autoConfirm, runId: write.runId });
    counts[result]++;
  }
  return counts;
}

export interface AiCharacterItem { name: string; aliases?: string[]; profile?: string; speech?: string; gender?: string; ageBand?: string; role?: string; player?: boolean; evidence?: string[] }
/** Characters: a new one lands as a draft; one already in the cast only gets its empty fields filled (a person's 'unknown' stays). */
export function aiSaveCharacters(tx: Tx, write: AiWrite, items: AiCharacterItem[]) {
  const counts = { added: 0, filled: 0 };
  const people = items.filter((item) => item.name?.trim()).map((item) => ({ ...item, name: item.name.trim(), aliases: strings(item.aliases) }));
  const { stored, live, canon, idByName } = cast(tx, write.projectId, people);
  const known = new Set(stored.flatMap((c) => namesOf(c).map(lower)));
  for (const c of people) {
    const gender = pick(GENDERS, c.gender, 'unknown');
    const ageBand = pick(AGE_BANDS, c.ageBand, 'unknown');
    const role = pick(CHARACTER_ROLES, c.role, 'unknown');
    const evidence = strings(c.evidence);
    if (namesOf(c).some((name) => known.has(lower(name))) || canon(c.name) !== c.name) {
      const existing = live.find((person) => person.id === idByName.get(lower(canon(c.name))));
      const profile = c.profile?.trim() ?? '';
      const speech = c.speech?.trim() ?? '';
      const fill = existing && {
        ...(!existing.profile.trim() && profile && { profile }),
        ...(!existing.speech.trim() && speech && { speech }),
        ...(existing.origin !== 'human' && existing.gender === 'unknown' && gender !== 'unknown' && { gender }),
        ...(existing.origin !== 'human' && existing.ageBand === 'unknown' && ageBand !== 'unknown' && { ageBand }),
        ...(existing.origin !== 'human' && existing.role === 'unknown' && role !== 'unknown' && { role }),
        ...(!existing.evidence.length && evidence.length && { evidence }),
      };
      if (existing && fill && Object.keys(fill).length) {
        tx.update(s.characters).set(fill).where(eq(s.characters.id, existing.id)).run();
        counts.filled++;
      }
      continue;
    }
    const row = tx.insert(s.characters).values({ projectId: write.projectId, name: c.name, aliases: c.aliases, profile: c.profile ?? '', speech: c.speech ?? '', player: c.player === true, gender, ageBand, role, evidence, ...draft(write) }).returning({ id: s.characters.id }).get();
    for (const name of namesOf(c)) {
      known.add(lower(name));
      if (!idByName.has(lower(name))) idByName.set(lower(name), row.id);
    }
    counts.added++;
  }
  return counts;
}

export interface AiRelationshipItem { from: string; to: string; kind: string; description?: string; mutual?: boolean; changes?: { at?: string; change?: string; cause?: string }[]; evidence?: string[] }
/**
 * Relationships between stored characters. A pair already related only gains new changes when it is an
 * unchecked AI relationship; a person's relationship is never edited — the change waits as a candidate beside it.
 */
export function aiSaveRelationships(tx: Tx, write: AiWrite, items: AiRelationshipItem[]) {
  const counts = { added: 0, changed: 0, proposed: 0, unresolved: [] as string[] };
  const { canon, idByName } = cast(tx, write.projectId, items.flatMap((item) => [{ name: item.from ?? '', aliases: [] }, { name: item.to ?? '', aliases: [] }]).filter((p) => p.name));
  const rels = tx.select().from(s.relationships).where(eq(s.relationships.projectId, write.projectId)).all();
  for (const item of items) {
    const fromId = idByName.get(lower(canon(item.from ?? '')));
    const toId = idByName.get(lower(canon(item.to ?? '')));
    if (!item.kind?.trim() || !fromId || !toId) {
      counts.unresolved.push(`${item.from} → ${item.to}`);
      continue;
    }
    const changes = (item.changes ?? []).flatMap((change) => (change.at && change.change ? [{ at: change.at, change: change.change, cause: change.cause ?? '' }] : []));
    const evidence = strings(item.evidence);
    const pair = rels.filter((rel) => rel.fromId === fromId && rel.toId === toId);
    if (!pair.length) {
      rels.push(tx.insert(s.relationships).values({ projectId: write.projectId, fromId, toId, kind: item.kind.trim(), description: item.description ?? '', mutual: item.mutual === true, changes, evidence, ...draft(write) }).returning().get());
      counts.added++;
      continue;
    }
    // A pair a person rejected is not proposed again.
    const fresh = changes.filter((change) => !pair.some((rel) => rel.changes.some((known) => known.at === change.at)));
    if (!fresh.length || pair.every((rel) => rel.status === 'rejected')) continue;
    const open = pair.find((rel) => rel.origin === 'ai' && rel.statusBy === 'ai' && rel.status !== 'rejected');
    if (open) {
      tx.update(s.relationships).set({ changes: [...open.changes, ...fresh], evidence: [...open.evidence, ...fresh.map((change) => change.at)] }).where(eq(s.relationships.id, open.id)).run();
      open.changes = [...open.changes, ...fresh];
      counts.changed++;
    } else {
      rels.push(tx.insert(s.relationships).values({ projectId: write.projectId, fromId, toId, kind: item.kind.trim(), description: `변경 제안: ${fresh.map((change) => change.change).join(' / ')}`, changes: fresh, evidence: fresh.map((change) => change.at), origin: 'ai', statusBy: 'ai', status: 'candidate' }).returning().get());
      counts.proposed++;
    }
  }
  return counts;
}

export interface AiSpeechRuleItem { fromName: string; toName: string; level: string; address?: string; note?: string; startKey?: string | null; evidence?: string[] }
/**
 * Speech rules. Used at once under auto-confirm; doubts only mark a rule 확인 권장 (rules of the main
 * pairs, evidence lines of someone else's speech). A person's confirmed rule for the same pair and
 * stretch that says otherwise wins, so the AI one stays a candidate beside it. A rule already there
 * (rejected ones too) is not added again.
 */
export function aiSaveSpeechRules(tx: Tx, write: AiWrite, items: AiSpeechRuleItem[]) {
  const counts = { added: 0, forReview: 0, skipped: [] as string[] };
  const { live, canon } = cast(tx, write.projectId, items.flatMap((item) => [{ name: item.fromName ?? '', aliases: [] }, { name: item.toName ?? '', aliases: [] }]).filter((p) => p.name));
  const person = personKey(live);
  const main = mainPairs(tx, write.projectId, live);
  const speakerOf = new Map(tx.select({ key: s.units.key, speaker: s.units.speaker }).from(s.units).where(eq(s.units.projectId, write.projectId)).all().map((unit) => [unit.key, unit.speaker]));
  const rules = tx.select().from(s.speechRules).where(eq(s.speechRules.projectId, write.projectId)).all();
  const ruleKey = (from: string, to: string, start: string | null, level: string, address: string) => `${person(from)}|${person(to)}|${start}|${level}|${address}`.toLowerCase();
  const taken = new Set(rules.map((r) => ruleKey(r.fromName, r.toName, r.startKey, r.level, r.address)));
  for (const r of items) {
    const level = SPEECH_LEVELS.find((candidate) => candidate === r.level);
    if (!r.fromName?.trim() || !r.toName?.trim() || !level) {
      counts.skipped.push(`${r.fromName} → ${r.toName}: 말투 등급이 올바르지 않습니다(${r.level})`);
      continue;
    }
    const from = canon(r.fromName);
    const to = canon(r.toName);
    const start = r.startKey?.trim() || null;
    const address = r.address ?? '';
    const key = ruleKey(from, to, start, level, address);
    if (taken.has(key)) continue;
    taken.add(key);
    const evidence = strings(r.evidence);
    const foreign = evidence.filter((line) => person(speakerOf.get(line) ?? '') !== person(from)).length;
    const official = rules.find((old) => old.statusBy === 'human' && old.status === 'confirmed' && person(old.fromName) === person(from) && person(old.toName) === person(to) && old.startKey === start);
    const reasons = [
      official && official.level !== level && `정식 규칙(${SPEECH_LEVEL_LABELS[official.level]})과 다름`,
      evidence.length && foreign * 2 > evidence.length && '근거 대사의 화자가 다름',
      main.has(`${person(from)}|${person(to)}`) && '대사가 많은 주요 쌍',
    ].filter(Boolean) as string[];
    if (reasons.length) counts.forReview++;
    const yieldsToPerson = Boolean(official && official.level !== level);
    const row = tx.insert(s.speechRules).values({ projectId: write.projectId, fromName: from, toName: to, level, address, note: r.note ?? '', startKey: start, evidence, ...draft(write), ...(yieldsToPerson && { status: 'candidate' as const }) }).returning().get();
    rules.push(row);
    if (reasons.length) markForReview(tx, write.projectId, 'speechRules', row.id, reasons);
    counts.added++;
  }
  return counts;
}

export interface AiEventItem { title: string; summary?: string; cause?: string; outcome?: string; participants?: string[]; evidence?: string[] }
/** Story events: one title is one event, so a title already stored (any status) is not added again. */
export function aiSaveEvents(tx: Tx, write: AiWrite, items: AiEventItem[]) {
  const counts = { added: 0 };
  const { canon } = cast(tx, write.projectId, []);
  const titles = new Set(tx.select({ title: s.storyEvents.title }).from(s.storyEvents).where(eq(s.storyEvents.projectId, write.projectId)).all().map((event) => lower(event.title)));
  for (const item of items) {
    if (!item.title?.trim() || titles.has(lower(item.title))) continue;
    titles.add(lower(item.title));
    tx.insert(s.storyEvents).values({ projectId: write.projectId, title: item.title.trim(), summary: item.summary ?? '', cause: item.cause ?? '', outcome: item.outcome ?? '', participants: strings(item.participants).map(canon), evidence: strings(item.evidence), ...draft(write) }).run();
    counts.added++;
  }
  return counts;
}

export interface AiDocumentItem { title: string; body: string; kind?: string; evidence?: string[] }
/** A reference document. The same title: an AI draft nobody touched is rewritten; a person's document (or a rejected one) is left. */
export function aiSaveDocument(tx: Tx, write: AiWrite, item: AiDocumentItem): 'added' | 'replaced' | 'kept' {
  const title = item.title.trim();
  const body = item.body;
  const sameTitle = tx.select().from(s.documents).where(eq(s.documents.projectId, write.projectId)).all().filter((doc) => same(doc.title, title));
  if (sameTitle.some((doc) => doc.status === 'rejected' && doc.body === body)) return 'kept';
  const live = sameTitle.find((doc) => doc.status !== 'rejected');
  if (live) {
    if (live.origin !== 'ai' || live.statusBy !== 'ai') return 'kept';
    tx.update(s.documents).set({ body, evidence: strings(item.evidence) }).where(eq(s.documents.id, live.id)).run();
    return 'replaced';
  }
  tx.insert(s.documents).values({ projectId: write.projectId, kind: pick(DOCUMENT_KINDS, item.kind, 'note'), title, body, evidence: strings(item.evidence), ...draft(write) }).run();
  return 'added';
}

// ── listeners ────────────────────────────────────────────────────────

export interface LineListenerItem { key: string; listener: string | null; confidence?: number }
/**
 * An AI's listener for named lines (origin ai, with its confidence). Only lines said to someone take
 * one, and a listener a person set or the import brought stays. Returns what was set and what was left, with why.
 */
export function aiSetLineListeners(tx: Tx, projectId: string, items: LineListenerItem[]) {
  const rules = tx.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.rules;
  const set: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const item of items) {
    const unit = tx.select({ id: s.units.id, kind: s.units.kind, speaker: s.units.speaker, source: s.units.source, listener: s.units.listener, listenerOrigin: s.units.listenerOrigin }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, item.key))).get();
    if (!unit) skipped.push({ key: item.key, reason: '없는 대사 키' });
    else if (unit.listenerOrigin === 'human') skipped.push({ key: item.key, reason: '사람이 정한 청자가 있습니다.' });
    else if (unit.listenerOrigin === 'import' && unit.listener) skipped.push({ key: item.key, reason: '가져온 청자가 있습니다.' });
    else if (setAiListener(tx, unit, cleanListener(item.listener), clampConfidence(item.confidence), rules)) set.push(item.key);
    else skipped.push({ key: item.key, reason: '청자가 필요 없는 줄입니다(지문·서식만 있는 줄).' });
  }
  return { set: set.length, skipped };
}

