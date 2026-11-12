import { and, asc, eq } from 'drizzle-orm';
import { isSpecialListener, isUnsureListener, OTHERS_LISTENER, SPEECH_LEVEL_LABELS, speechLevelOf, type SpeechLevel } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { cachedKnowledge, graphOrder, scriptOrder } from './knowledge-cache.ts';

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
  if (isUnsureListener(line)) return null;
  return line.listener;
}

/** The rule for one line; `byOrder` when script order picked its stretch, `routeDependent` when the graph could not because routes differ. */
export interface Resolved {
  listener: string;
  rule: Rule;
  byOrder: boolean;
  routeDependent?: true;
  /** The speaker's rule for everyone else (no rule names this listener). */
  others?: true;
}

/**
 * Confirmed speech rules for a project, resolvable per line. Names match a character's name or
 * alias, so a rule for "Mara" applies to lines whose speaker key is an alias of hers.
 */
export function speechRuleIndex(db: Db, projectId: string) {
  const { norm, byPair, order } = cachedKnowledge(db, projectId, 'speechRuleIndex', ['characters', 'speech_rules', 'order'], () => {
    const people = db.select({ name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(and(eq(s.characters.projectId, projectId), eq(s.characters.status, 'confirmed'))).all();
    const canon = new Map<string, string>();
    for (const person of people) for (const name of [person.name, ...person.aliases]) canon.set(name.toLowerCase(), person.name.toLowerCase());
    const norm = (name: string) => canon.get(name.toLowerCase()) ?? name.toLowerCase();
    const rules = db.select().from(s.speechRules).where(and(eq(s.speechRules.projectId, projectId), eq(s.speechRules.status, 'confirmed'))).all();
    const order = rules.some((rule) => rule.startKey) ? scriptOrder(db, projectId) : new Map<string, number>();
    const byPair = Map.groupBy(rules, (rule) => `${norm(rule.fromName)}|${norm(rule.toName)}`);
    for (const list of byPair.values()) list.sort((a, b) => (a.startKey ? (order.get(a.startKey) ?? 0) : -1) - (b.startKey ? (order.get(b.startKey) ?? 0) : -1));
    return { norm, byPair, order };
  });

  return {
    norm,
    /**
     * The rules that apply to these lines (by key); lines without a known listener or rule are absent.
     * A rule with a start point applies where the dialogue graph certainly passed that point, and the
     * latest such start wins; a start on a branch that never leads to the line does not count.
     * Where a start is passed on some routes only, one translation cannot fit every route: the rule
     * is picked by script order and marked (`byOrder` + `routeDependent`, key added to `uncertain`)
     * so a person can review it. Lines or starts outside the graph also fall back to script order.
     */
    resolve(lines: LineLike[], uncertain?: Set<string>): Map<string, Resolved> {
      const result = new Map<string, Resolved>();
      const graph = [...byPair.values()].some((list) => list.some((rule) => rule.startKey)) ? graphOrder(db, projectId) : null;
      let lineOrder: Map<string, number> | undefined;
      for (const line of lines) {
        const listener = knownListener(line);
        if (!line.speaker || !listener) continue;
        // Nobody's own rule: the speaker's rule for everyone else (not for a group, the public or themself).
        const own = byPair.get(`${norm(line.speaker)}|${norm(listener)}`);
        const others = !own?.length && !isSpecialListener(listener) ? byPair.get(`${norm(line.speaker)}|${OTHERS_LISTENER}`) : undefined;
        const list = own?.length ? own : others;
        if (!list?.length) continue;
        const fallback = others ? { others: true as const } : {};
        const base = list.filter((rule) => !rule.startKey).at(-1);
        const starts = list.filter((rule) => rule.startKey);
        if (!starts.length || !graph) {
          if (base) result.set(line.key, { listener, rule: base, byOrder: false, ...fallback });
          continue;
        }
        const passed = starts.map((rule) => ({ rule, passage: graph.passage(rule.startKey!, line.key) }));
        const byScriptOrder = (candidates: Rule[]) => {
          lineOrder ??= scriptOrder(db, projectId);
          const at = lineOrder.get(line.key) ?? 0;
          return candidates.filter((candidate) => !candidate.startKey || (order.get(candidate.startKey) ?? Infinity) <= at).at(-1);
        };
        if (passed.some(({ passage }) => passage === 'unknown')) {
          const rule = byScriptOrder(list);
          if (rule) result.set(line.key, { listener, rule, byOrder: true, ...fallback });
          continue;
        }
        // Starts certainly passed all dominate the line, so they lie on one chain: the deepest is the latest.
        const latest = passed.filter(({ passage }) => passage === 'definite').reduce<Rule | undefined>((best, { rule }) => (!best || graph.later(rule.startKey!, best.startKey!) ? rule : best), undefined);
        // A start passed on some routes only matters unless it always comes before the latest certain start.
        const open = passed.filter(({ rule, passage }) => passage === 'maybe' && !(latest && graph.leadsTo(rule.startKey!, latest.startKey!) && !graph.leadsTo(latest.startKey!, rule.startKey!)));
        if (open.length) {
          uncertain?.add(line.key);
          // Starts on branches that never reach this line are left out even here.
          const rule = byScriptOrder(list.filter((candidate) => !candidate.startKey || passed.some((entry) => entry.rule === candidate && entry.passage !== 'none')));
          if (rule) result.set(line.key, { listener, rule, byOrder: true, routeDependent: true, ...fallback });
          continue;
        }
        const rule = latest ?? base;
        if (rule) result.set(line.key, { listener, rule, byOrder: false, ...fallback });
      }
      return result;
    },
  };
}

/** How a rule reads in a prompt or a check. */
/** "하게체, 호칭 "행크 경위님" 또는 "경위님"": the level and every form of address (kept comma-separated). */
export const describeRule = (rule: Rule) => {
  const forms = rule.address.split(',').map((form) => form.trim()).filter(Boolean);
  return [SPEECH_LEVEL_LABELS[rule.level], forms.length && `호칭 ${forms.map((form) => `"${form}"`).join(' 또는 ')}`].filter(Boolean).join(', ');
};

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
    .orderBy(asc(s.units.seq))
    .all()
    .filter((line) => line.speaker && index.norm(line.speaker) === index.norm(rule.fromName) && knownListener(line) && index.norm(knownListener(line)!) === index.norm(rule.toName));
  // A candidate rule is not resolved by the index; show the lines it would take over.
  const uncertain = new Set<string>();
  const resolved = index.resolve(speakers, uncertain);
  const rows = rule.status === 'confirmed' ? speakers.filter((line) => resolved.get(line.key)?.rule.id === rule.id) : speakers;
  const levels: Partial<Record<SpeechLevel | 'unknown', number>> = {};
  for (const line of rows) {
    const level = line.translation ? (speechLevelOf(line.translation) ?? 'unknown') : 'unknown';
    levels[level] = (levels[level] ?? 0) + 1;
  }
  // Of these, lines whose stretch depends on the route (picked by script order).
  const routeDependent = rows.filter((line) => uncertain.has(line.key)).length;
  // Only translated lines have endings to fix; untranslated ones get the rule when they are translated.
  const translatedIds = rows.filter((line) => line.translation?.trim()).map((line) => line.id);
  // Ids only: the pane shows the first lines from the browser's units collection.
  return { count: rows.length, routeDependent, unitIds: rows.map((line) => line.id), translatedIds, levels };
}
