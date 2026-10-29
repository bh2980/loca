import { and, eq, inArray, ne } from 'drizzle-orm';
import { AGE_BANDS, aiStatus, CHARACTER_ROLES, DOCUMENT_KINDS, GENDERS, isSpecialListener, LISTENER_MIN_CONFIDENCE, SPEECH_LEVELS, TERM_KIND_LABELS, TERM_KINDS, NOT_A_PERSON_NOTE, UNRESOLVED_RELATIONSHIP_KIND } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { markForReview } from './knowledge-tags.ts';
import { clampConfidence, cleanListener, setAiListener } from './listeners.ts';
import { knownListener } from './speech.ts';
import { upsertAiTerm } from './terms.ts';

/**
 * What an AI result does to the project's knowledge and listeners. One home for the rules of the
 * 반영 nodes written straight into the project (engine/functions/apply.ts) and for `set_listeners`
 * (the chat/CLI tool and an accepted proposal): new AI items land as AI › 사용 방식 says (confirmed or
 * candidates), stored text is never rewritten, and what an AI result adds to a stored item (new facts
 * of a person, new changes of a relationship) is appended whatever its origin. Everything runs in the
 * caller's transaction.
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
  const stored = tx.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases, status: s.characters.status, statusBy: s.characters.statusBy, profile: s.characters.profile, speech: s.characters.speech, gender: s.characters.gender, ageBand: s.characters.ageBand, role: s.characters.role, origin: s.characters.origin, evidence: s.characters.evidence }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
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

/** One new fact (or habit of speech) of a person with the lines that show it. */
export interface AiFact { text: string; evidence?: string[] }
export interface AiCharacterItem { name: string; aliases?: string[]; newFacts?: AiFact[]; newSpeech?: AiFact[]; gender?: string; ageBand?: string; role?: string; player?: boolean; evidence?: string[] }

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const facts = (value: unknown): AiFact[] =>
  Array.isArray(value) ? value.flatMap((entry) => (entry && typeof entry === 'object' && typeof (entry as AiFact).text === 'string' && (entry as AiFact).text.trim() ? [{ text: (entry as AiFact).text.trim().replace(/\s*\n\s*/g, ' '), evidence: strings((entry as AiFact).evidence) }] : [])) : [];
/**
 * `stored` with each new fact on a line of its own at the end. A fact whose text already appears in the
 * text (whitespace and case ignored, so also one added a moment ago) is not added. Returns the whole
 * text and the facts that were added.
 */
export function appendFacts(stored: string, list: AiFact[]) {
  let text = stored.trimEnd();
  let seen = squash(text);
  const added: AiFact[] = [];
  for (const fact of facts(list)) {
    const key = squash(fact.text);
    if (seen.includes(key)) continue;
    seen += ` ${key}`;
    text = text ? `${text}\n${fact.text}` : fact.text;
    added.push(fact);
  }
  return { text: added.length ? text : stored, added };
}
const union = (...lists: string[][]) => [...new Set(lists.flat())];

/**
 * People found in one answer that are the same person, by the rule canonicalNames applies to stored people
 * (the single-word name or alias of one is a whole word of the other's name: "Voltaire" and "Inspector
 * Voltaire"; the same name twice also counts; aliases never link two entries): they become ONE entry, named by the most complete name (the
 * one with most words, else the first), the other names as aliases, facts and evidence joined. A single word
 * that is a word of several different found names links none of them. No other heuristic.
 */
export function mergeFoundPeople<T extends AiCharacterItem & { aliases: string[] }>(people: T[]): { people: T[]; merged: number } {
  const parent = people.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)));
  const links: { from: number; to: number }[] = [];
  people.forEach((person, index) => {
    const others = people.map((other, at) => ({ other, at })).filter(({ at }) => at !== index);
    // Names only: a name another entry lists as its alias is that entry's claim, not a link (as two stored people are never merged).
    const map = canonicalNames(others.map(({ other }) => ({ name: other.name, aliases: [] })), [{ name: person.name, aliases: [] }]);
    const target = map.get(lower(person.name));
    const match = target === undefined ? undefined : others.find(({ other }) => same(other.name, target));
    if (match) links.push({ from: index, to: match.at });
  });
  // A name that fits several different found names links none of them.
  const byTarget = new Map<number, Set<string>>();
  for (const { from, to } of links) byTarget.set(to, (byTarget.get(to) ?? new Set()).add(lower(people[from]!.name)));
  for (const { from, to } of links) if ((byTarget.get(to)?.size ?? 0) === 1) parent[root(from)] = root(to);
  const groups = new Map<number, T[]>();
  people.forEach((person, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), person]));
  const words = (name: string) => name.trim().split(/\s+/).length;
  const result = [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const lead = group.reduce((best, person) => (words(person.name) > words(best.name) ? person : best), group[0]!);
    const gathered = group.flatMap((person) => namesOf(person));
    const aliases = gathered.filter((name, index) => !same(name, lead.name) && gathered.findIndex((other) => same(other, name)) === index);
    const known = <K extends 'gender' | 'ageBand' | 'role'>(key: K) => group.map((person) => person[key]).find((value) => value && value !== 'unknown');
    return {
      ...lead,
      aliases,
      newFacts: group.flatMap((person) => person.newFacts ?? []),
      newSpeech: group.flatMap((person) => person.newSpeech ?? []),
      gender: known('gender') ?? lead.gender,
      ageBand: known('ageBand') ?? lead.ageBand,
      role: known('role') ?? lead.role,
      player: group.some((person) => person.player === true) || undefined,
      evidence: union(...group.map((person) => strings(person.evidence))),
    };
  });
  return { people: result, merged: people.length - result.length };
}

/** A speaker label the AI says is not a person, with why. */
export interface AiNotPerson { name?: string; reason?: string }
/**
 * Characters: a new one lands as a draft whose profile and speech description are its new facts, one per
 * line. One already in the cast, whoever made it, is never rewritten: it gains the new names it goes by
 * (never a name that belongs to another stored person: two stored people are not merged), gets its unknown
 * role, gender and age band filled (not a person's: their 'unknown' stays) and the new facts and habits of
 * speech are appended to the end of its profile and speech description, each on its own line, unless the
 * text already says it. The evidence lines of an appended fact are added to the person's evidence.
 */
export function aiSaveCharacters(tx: Tx, write: AiWrite, items: AiCharacterItem[], notPeople: AiNotPerson[] = []) {
  const counts = { added: 0, filled: 0, appended: 0, merged: 0, notPeople: 0, flagged: 0 };
  const notNamed = new Map(notPeople.filter((entry) => entry.name?.trim()).map((entry) => [lower(entry.name!), entry.reason?.trim() || '이유를 적지 않았습니다']));
  // A name the AI says is not a person makes no character; a stored character of that name only gets 확인 권장 for a person to decide.
  const all = tx.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(and(eq(s.characters.projectId, write.projectId), ne(s.characters.status, 'rejected'))).all();
  for (const [name, reason] of notNamed) {
    const hit = all.find((person) => namesOf(person).some((candidate) => lower(candidate) === name));
    if (!hit) continue;
    markForReview(tx, write.projectId, 'characters', hit.id, [`${NOT_A_PERSON_NOTE}${reason}`]);
    counts.flagged++;
  }
  const named = items.filter((item) => item.name?.trim()).map((item) => ({ ...item, name: item.name.trim(), aliases: strings(item.aliases) }));
  const kept = named.filter((item) => !notNamed.has(lower(item.name)));
  counts.notPeople = named.length - kept.length;
  const { people, merged } = mergeFoundPeople(kept);
  counts.merged = merged;
  const { stored, live, canon, idByName } = cast(tx, write.projectId, people);
  const known = new Set(stored.flatMap((c) => namesOf(c).map(lower)));
  for (const c of people) {
    const gender = pick(GENDERS, c.gender, 'unknown');
    const ageBand = pick(AGE_BANDS, c.ageBand, 'unknown');
    const role = pick(CHARACTER_ROLES, c.role, 'unknown');
    const evidence = strings(c.evidence);
    if (namesOf(c).some((name) => known.has(lower(name))) || canon(c.name) !== c.name) {
      const id = [canon(c.name), ...c.aliases].map((name) => idByName.get(lower(name))).find(Boolean);
      const existing = live.find((person) => person.id === id);
      if (!existing) continue;
      // Names of the other stored people (rejected ones too) are theirs, whoever else claims them.
      const theirs = new Set(stored.filter((other) => other.id !== existing.id).flatMap((other) => namesOf(other).map(lower)));
      const mine = new Set(namesOf(existing).map(lower));
      const fresh: string[] = [];
      for (const name of [c.name, ...c.aliases]) {
        if (mine.has(lower(name)) || theirs.has(lower(name))) continue;
        mine.add(lower(name));
        fresh.push(name);
      }
      const fill: Partial<typeof s.characters.$inferInsert> = {
        ...(fresh.length && { aliases: [...existing.aliases, ...fresh] }),
        ...(existing.gender === 'unknown' && gender !== 'unknown' && { gender }),
        ...(existing.ageBand === 'unknown' && ageBand !== 'unknown' && { ageBand }),
        ...(existing.role === 'unknown' && role !== 'unknown' && { role }),
      };
      const appended = { profile: appendFacts(existing.profile, c.newFacts ?? []), speech: appendFacts(existing.speech, c.newSpeech ?? []) };
      const added = [...appended.profile.added, ...appended.speech.added];
      const names = Object.keys(fill).length > 0;
      if (added.length) {
        fill.profile = appended.profile.text;
        fill.speech = appended.speech.text;
      }
      const gained = union(!existing.evidence.length ? evidence : [], ...added.map((fact) => fact.evidence ?? [])).filter((line) => !existing.evidence.includes(line));
      if (gained.length) fill.evidence = [...existing.evidence, ...gained];
      if (Object.keys(fill).length) tx.update(s.characters).set(fill).where(eq(s.characters.id, existing.id)).run();
      if (names) counts.filled++;
      if (added.length) counts.appended++;
      continue;
    }
    const profile = appendFacts('', c.newFacts ?? []);
    const speech = appendFacts('', c.newSpeech ?? []);
    const row = tx.insert(s.characters).values({ projectId: write.projectId, name: c.name, aliases: c.aliases, profile: profile.text, speech: speech.text, player: c.player === true, gender, ageBand, role, evidence: union(evidence, ...[...profile.added, ...speech.added].map((fact) => fact.evidence ?? [])), ...draft(write) }).returning({ id: s.characters.id }).get();
    for (const name of namesOf(c)) {
      known.add(lower(name));
      if (!idByName.has(lower(name))) idByName.set(lower(name), row.id);
    }
    counts.added++;
  }
  // What only some answers do is reported only when it happened.
  const { merged: joined, notPeople: skippedNames, flagged, ...base } = counts;
  return { ...base, ...(joined && { merged: joined }), ...(skippedNames && { notPeople: skippedNames }), ...(flagged && { flagged }) };
}

export interface AiRelationshipChange { at?: string; kind?: string; cause?: string }
export interface AiRelationshipItem { from: string; to: string; kind: string; description?: string; mutual?: boolean; changes?: AiRelationshipChange[]; evidence?: string[] }
/** One direction of an AI-read pair: who `to` is to `from`, and how that changes. */
export type AiRelationshipView = Omit<AiRelationshipItem, 'mutual'>;
/** A pair as the AI nodes answer it: one or two views, each a direction. */
export interface AiRelationshipPair { views: AiRelationshipView[] }

const sameChanges = (a: AiRelationshipView, b: AiRelationshipView) => {
  const [x, y] = [a.changes ?? [], b.changes ?? []];
  return x.length === y.length && x.every((change, index) => change.at === y[index]!.at && same(change.kind ?? '', y[index]!.kind ?? ''));
};

/**
 * The directional rows of AI-read pairs. Each view is a row of its own; two views with the same kind
 * and the same changes (the same new kind at the same lines, or none) are one row, mutual. A pair with
 * one view is one directional row: the script shows only that direction.
 */
export function relationshipRows(pairs: AiRelationshipPair[]): AiRelationshipItem[] {
  const rows: AiRelationshipItem[] = [];
  for (const pair of pairs) {
    const views = pair.views ?? [];
    const [first, second] = views;
    if (views.length === 2 && first!.kind.trim() && same(first!.kind, second!.kind) && sameChanges(first!, second!) && same(first!.from, second!.to) && same(first!.to, second!.from)) {
      rows.push({ ...first!, description: first!.description?.trim() ? first!.description : second!.description, evidence: [...new Set([...strings(first!.evidence), ...strings(second!.evidence)])], mutual: true });
    } else rows.push(...views);
  }
  return rows;
}
/**
 * Relationships between stored characters. A pair already related (whoever made it) keeps its kind and
 * description and gains the answer's new changes at the end of its changes (not one at a line it already
 * has a change at); a pair a person rejected gains nothing.
 */
export function aiSaveRelationships(tx: Tx, write: AiWrite, items: AiRelationshipItem[]) {
  const counts = { added: 0, changed: 0, unresolved: [] as string[] };
  const { canon, idByName } = cast(tx, write.projectId, items.flatMap((item) => [{ name: item.from ?? '', aliases: [] }, { name: item.to ?? '', aliases: [] }]).filter((p) => p.name));
  const all = tx.select().from(s.relationships).where(eq(s.relationships.projectId, write.projectId)).all();
  // "관계 미확인" rows are not relationships: a real one for the pair takes their place (an AI one nobody looked at goes), and they never block it.
  const rels = all.filter((rel) => rel.kind !== UNRESOLVED_RELATIONSHIP_KIND);
  let placeholders = all.filter((rel) => rel.kind === UNRESOLVED_RELATIONSHIP_KIND && rel.status === 'candidate' && rel.statusBy === 'ai');
  for (const item of items) {
    const fromId = idByName.get(lower(canon(item.from ?? '')));
    const toId = idByName.get(lower(canon(item.to ?? '')));
    if (!item.kind?.trim() || !fromId || !toId) {
      counts.unresolved.push(`${item.from} → ${item.to}`);
      continue;
    }
    const changes = (item.changes ?? []).flatMap((change) => (change.at && change.kind?.trim() ? [{ at: change.at, kind: change.kind.trim(), cause: change.cause ?? '' }] : []));
    const evidence = strings(item.evidence);
    const stale = placeholders.filter((rel) => (rel.fromId === fromId && rel.toId === toId) || (rel.fromId === toId && rel.toId === fromId));
    if (stale.length) {
      const ids = stale.map((rel) => rel.id);
      tx.delete(s.knowledgeTags).where(and(eq(s.knowledgeTags.kind, 'relationships'), inArray(s.knowledgeTags.itemId, ids))).run();
      tx.delete(s.relationships).where(inArray(s.relationships.id, ids)).run();
      placeholders = placeholders.filter((rel) => !ids.includes(rel.id));
    }
    const pair = rels.filter((rel) => rel.fromId === fromId && rel.toId === toId);
    if (!pair.length) {
      rels.push(tx.insert(s.relationships).values({ projectId: write.projectId, fromId, toId, kind: item.kind.trim(), description: item.description ?? '', mutual: item.mutual === true, changes, evidence, ...draft(write) }).returning().get());
      counts.added++;
      continue;
    }
    // A pair a person rejected gains nothing.
    const target = pair.find((rel) => rel.status !== 'rejected');
    const fresh = changes.filter((change, index) => changes.findIndex((other) => other.at === change.at) === index && !pair.some((rel) => rel.changes.some((known) => known.at === change.at)));
    if (!target || !fresh.length) continue;
    tx.update(s.relationships).set({ changes: [...target.changes, ...fresh], evidence: union(target.evidence, fresh.map((change) => change.at)) }).where(eq(s.relationships.id, target.id)).run();
    target.changes = [...target.changes, ...fresh];
    counts.changed++;
  }
  return counts;
}

/** A pair the AI could not give a relationship, with why. */
export interface AiUnresolvedPair { between?: string[]; reason?: string; kind?: string }
/**
 * Pairs of people who talk to each other that the AI wrote no relationship for. Each pair of two stored
 * characters becomes a candidate relationship of kind "관계 미확인" (never confirmed, whatever 바로 확정
 * says), the AI's reason as its description and 확인 권장 on it, so a person sees what is missing. A pair
 * that already has a relationship in either direction (or an earlier "관계 미확인" row, even a rejected one)
 * gets nothing. A pair with someone who is not a stored character (no person, an extra, a misspelling) is
 * dropped and listed in `dropped`, so the step reports it. A pair of kind notPerson (one of them is not a
 * person) is dropped and only counted in `notPerson`.
 */
export function aiSaveUnresolvedPairs(tx: Tx, write: AiWrite, items: AiUnresolvedPair[]) {
  const counts = { added: 0, kept: 0, notPerson: 0, dropped: [] as string[] };
  const names = items.flatMap((item) => strings(item.between).slice(0, 2).map((name) => ({ name, aliases: [] })));
  const { canon, idByName } = cast(tx, write.projectId, names);
  const rels = tx.select({ fromId: s.relationships.fromId, toId: s.relationships.toId }).from(s.relationships).where(eq(s.relationships.projectId, write.projectId)).all();
  const seen = new Set<string>();
  for (const item of items) {
    if (item.kind === 'notPerson') {
      counts.notPerson++;
      continue;
    }
    const between = strings(item.between);
    const label = `${between.join(' ↔ ')}${item.reason?.trim() ? `: ${item.reason.trim()}` : ''}`;
    const [a, b] = between.map((name) => idByName.get(lower(canon(name))));
    if (between.length !== 2 || !a || !b || a === b) {
      counts.dropped.push(label);
      continue;
    }
    const key = [a, b].sort().join('|');
    if (seen.has(key) || rels.some((rel) => (rel.fromId === a && rel.toId === b) || (rel.fromId === b && rel.toId === a))) {
      counts.kept++;
      continue;
    }
    seen.add(key);
    const reason = item.reason?.trim() || '이유를 적지 않았습니다';
    const row = tx.insert(s.relationships).values({ projectId: write.projectId, fromId: a, toId: b, kind: UNRESOLVED_RELATIONSHIP_KIND, description: reason, mutual: true, status: 'candidate', statusBy: 'ai', origin: 'ai' }).returning({ id: s.relationships.id }).get();
    markForReview(tx, write.projectId, 'relationships', row.id, [`${UNRESOLVED_RELATIONSHIP_KIND}: ${reason}`]);
    counts.added++;
  }
  const { notPerson, ...rest } = counts;
  return { ...rest, ...(notPerson && { notPerson }) };
}

export interface AiSpeechRuleItem { fromName: string; toName: string; level: string; address?: string; note?: string; startKey?: string | null; evidence?: string[] }
/**
 * Speech rules. A new one (a pair or a stretch with no rule yet) is used at once under auto-confirm;
 * doubts only mark it 확인 권장 (rules of the main pairs, evidence lines of someone else's speech). A
 * stored rule stays whatever its origin: one for the same pair and stretch (the same speaker → listener
 * and start line) that the answer gives again or differently is not added and not made a candidate.
 * A rule a person rejected is only not added again (the same level and address).
 */
export function aiSaveSpeechRules(tx: Tx, write: AiWrite, items: AiSpeechRuleItem[]) {
  const counts = { added: 0, kept: 0, forReview: 0, skipped: [] as string[] };
  const { live, canon } = cast(tx, write.projectId, items.flatMap((item) => [{ name: item.fromName ?? '', aliases: [] }, { name: item.toName ?? '', aliases: [] }]).filter((p) => p.name));
  const person = personKey(live);
  const main = mainPairs(tx, write.projectId, live);
  const speakerOf = new Map(tx.select({ key: s.units.key, speaker: s.units.speaker }).from(s.units).where(eq(s.units.projectId, write.projectId)).all().map((unit) => [unit.key, unit.speaker]));
  const rules = tx.select().from(s.speechRules).where(eq(s.speechRules.projectId, write.projectId)).all();
  const ruleKey = (from: string, to: string, start: string | null, level: string, address: string) => `${person(from)}|${person(to)}|${start}|${level}|${address}`.toLowerCase();
  const taken = new Set(rules.filter((r) => r.status === 'rejected').map((r) => ruleKey(r.fromName, r.toName, r.startKey, r.level, r.address)));
  const stretchOf = (r: { fromName: string; toName: string; startKey: string | null }) => `${person(r.fromName)}|${person(r.toName)}|${r.startKey}`.toLowerCase();
  const stretches = new Set(rules.filter((r) => r.status !== 'rejected').map(stretchOf));
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
    if (stretches.has(stretchOf({ fromName: from, toName: to, startKey: start }))) {
      counts.kept++;
      continue;
    }
    const key = ruleKey(from, to, start, level, address);
    if (taken.has(key)) continue;
    taken.add(key);
    stretches.add(stretchOf({ fromName: from, toName: to, startKey: start }));
    const evidence = strings(r.evidence);
    const foreign = evidence.filter((line) => person(speakerOf.get(line) ?? '') !== person(from)).length;
    const reasons = [
      evidence.length && foreign * 2 > evidence.length && '근거 대사의 화자가 다름',
      main.has(`${person(from)}|${person(to)}`) && '대사가 많은 주요 쌍',
    ].filter(Boolean) as string[];
    if (reasons.length) counts.forReview++;
    const row = tx.insert(s.speechRules).values({ projectId: write.projectId, fromName: from, toName: to, level, address, note: r.note ?? '', startKey: start, evidence, ...draft(write) }).returning().get();
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
 * one, and a listener a person set or the import brought stays. Returns what was set and what was left, with why,
 * and which set lines are below the confidence the app trusts (they still read as 청자 미상).
 */
export function aiSetLineListeners(tx: Tx, projectId: string, items: LineListenerItem[]) {
  const rules = tx.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.rules;
  const set: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  const unsure: string[] = [];
  for (const item of items) {
    const unit = tx.select({ id: s.units.id, kind: s.units.kind, speaker: s.units.speaker, source: s.units.source, listener: s.units.listener, listenerOrigin: s.units.listenerOrigin }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, item.key))).get();
    if (!unit) skipped.push({ key: item.key, reason: '없는 대사 키' });
    else if (unit.listenerOrigin === 'human') skipped.push({ key: item.key, reason: '사람이 정한 청자가 있습니다.' });
    else if (unit.listenerOrigin === 'import' && unit.listener) skipped.push({ key: item.key, reason: '가져온 청자가 있습니다.' });
    else if (setAiListener(tx, unit, cleanListener(item.listener), clampConfidence(item.confidence), rules)) {
      set.push(item.key);
      if (item.listener && clampConfidence(item.confidence) < LISTENER_MIN_CONFIDENCE) unsure.push(item.key);
    } else skipped.push({ key: item.key, reason: '청자가 필요 없는 줄입니다(지문·서식만 있는 줄).' });
  }
  return { set: set.length, skipped, unsure };
}

