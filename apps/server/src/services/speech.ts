import { and, asc, eq, inArray } from 'drizzle-orm';
import { LISTENER_MIN_CONFIDENCE, SPEECH_LEVEL_LABELS, speechLevelOf, type SpeechLevel } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

type Rule = typeof s.speechRules.$inferSelect;
interface LineLike {
  key: string;
  speaker: string | null;
  listener: string | null;
  listenerOrigin: 'import' | 'ai' | 'human' | null;
  listenerConfidence: number | null;
}

/** The listener a rule may use: an unsure AI guess counts as unknown. */
export function knownListener(line: Pick<LineLike, 'listener' | 'listenerOrigin' | 'listenerConfidence'>): string | null {
  if (!line.listener) return null;
  if (line.listenerOrigin === 'ai' && (line.listenerConfidence ?? 0) < LISTENER_MIN_CONFIDENCE) return null;
  return line.listener;
}

/** Script order of every line (scene order, then line order): rule intervals are picked by it, ignoring branches. */
function scriptOrder(db: Db, projectId: string, keys: string[]) {
  if (!keys.length) return new Map<string, number>();
  const rows = inChunks(keys, (slice) =>
    db
      .select({ key: s.units.key, groupSort: s.groups.sort, sort: s.units.sort })
      .from(s.units)
      .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
      .where(and(eq(s.units.projectId, projectId), inArray(s.units.key, slice)))
      .all(),
  );
  // Group sort dominates; unit sort stays far below a group step.
  return new Map(rows.map((row) => [row.key, row.groupSort * 1_000_000 + row.sort]));
}

/**
 * Confirmed speech rules for a project, resolvable per line. Names match a character's name or
 * alias, so a rule for "Mara" applies to lines whose speaker key is an alias of hers.
 */
export function speechRuleIndex(db: Db, projectId: string) {
  const people = db.select({ name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(and(eq(s.characters.projectId, projectId), eq(s.characters.status, 'confirmed'))).all();
  const canon = new Map<string, string>();
  for (const person of people) for (const name of [person.name, ...person.aliases]) canon.set(name.toLowerCase(), person.name.toLowerCase());
  const norm = (name: string) => canon.get(name.toLowerCase()) ?? name.toLowerCase();
  const rules = db.select().from(s.speechRules).where(and(eq(s.speechRules.projectId, projectId), eq(s.speechRules.status, 'confirmed'))).all();
  const order = scriptOrder(db, projectId, rules.flatMap((rule) => (rule.startKey ? [rule.startKey] : [])));
  const byPair = Map.groupBy(rules, (rule) => `${norm(rule.fromName)}|${norm(rule.toName)}`);
  for (const list of byPair.values()) list.sort((a, b) => (a.startKey ? (order.get(a.startKey) ?? 0) : -1) - (b.startKey ? (order.get(b.startKey) ?? 0) : -1));

  return {
    norm,
    /** The rules that apply to these lines (by key); lines without a known listener or rule are absent. */
    resolve(lines: LineLike[]): Map<string, { listener: string; rule: Rule; byOrder: boolean }> {
      const result = new Map<string, { listener: string; rule: Rule; byOrder: boolean }>();
      const lineOrder = scriptOrder(db, projectId, lines.map((line) => line.key));
      for (const line of lines) {
        const listener = knownListener(line);
        if (!line.speaker || !listener) continue;
        const list = byPair.get(`${norm(line.speaker)}|${norm(listener)}`);
        if (!list?.length) continue;
        const at = lineOrder.get(line.key) ?? 0;
        const rule = list.filter((candidate) => !candidate.startKey || (order.get(candidate.startKey) ?? Infinity) <= at).at(-1);
        if (rule) result.set(line.key, { listener, rule, byOrder: list.length > 1 });
      }
      return result;
    },
  };
}

/** How a rule reads in a prompt or a check. */
export const describeRule = (rule: Rule) => [SPEECH_LEVEL_LABELS[rule.level], rule.address && `호칭 "${rule.address}"`].filter(Boolean).join(', ');

/** Does the translation end in the rule's level? Null when the level cannot be guessed from the text. */
export function speechMismatch(rule: Rule, translation: string | null): string | null {
  if (!translation || rule.level === 'other') return null;
  const guessed = speechLevelOf(translation);
  if (!guessed || guessed === rule.level) return null;
  return `말투 규칙은 ${SPEECH_LEVEL_LABELS[rule.level]}인데 번역은 ${SPEECH_LEVEL_LABELS[guessed]}로 끝납니다(어미로 추정).`;
}

/** The lines a rule governs now: its speaker → listener pair, within its stretch. For "affected lines → re-run". */
export function ruleLines(db: Db, projectId: string, ruleId: string) {
  const index = speechRuleIndex(db, projectId);
  const rule = db.select().from(s.speechRules).where(and(eq(s.speechRules.id, ruleId), eq(s.speechRules.projectId, projectId))).get();
  if (!rule) return null;
  const speakers = db
    .select({ id: s.units.id, key: s.units.key, groupId: s.units.groupId, groupTitle: s.groups.title, speaker: s.units.speaker, listener: s.units.listener, listenerOrigin: s.units.listenerOrigin, listenerConfidence: s.units.listenerConfidence, source: s.units.source, translation: s.units.translation })
    .from(s.units)
    .innerJoin(s.groups, eq(s.groups.id, s.units.groupId))
    .where(and(eq(s.units.projectId, projectId), eq(s.units.kind, 'dialogue')))
    .orderBy(asc(s.groups.sort), asc(s.units.sort))
    .all()
    .filter((line) => line.speaker && index.norm(line.speaker) === index.norm(rule.fromName) && knownListener(line) && index.norm(knownListener(line)!) === index.norm(rule.toName));
  // A candidate rule is not resolved by the index; show the lines it would take over.
  const resolved = index.resolve(speakers);
  const rows = rule.status === 'confirmed' ? speakers.filter((line) => resolved.get(line.key)?.rule.id === rule.id) : speakers;
  const levels: Partial<Record<SpeechLevel | 'unknown', number>> = {};
  for (const line of rows) {
    const level = line.translation ? (speechLevelOf(line.translation) ?? 'unknown') : 'unknown';
    levels[level] = (levels[level] ?? 0) + 1;
  }
  return { count: rows.length, unitIds: rows.map((line) => line.id), levels, rows: rows.slice(0, 100).map(({ listenerOrigin: _o, listenerConfidence: _c, ...line }) => line) };
}
