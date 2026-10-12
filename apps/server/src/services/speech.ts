import { and, asc, eq } from 'drizzle-orm';
import { LISTENER_MIN_CONFIDENCE, SPEECH_LEVEL_LABELS, politenessOfLevel, speechLevelOf, termMatcher, type Politeness, type SpeechLevel } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { buildGraphOrder } from './graph-order.ts';

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

// ── knowledge snapshot cache ─────────────────────────────────────────
//
// better-sqlite3 is synchronous, so re-reading whole knowledge tables per batch or per line blocks
// the server. Reads are cached per project and validated by a version per table. The versions are
// bumped by TEMP triggers (installed on the connection) that call a JS function on every insert,
// update or delete, so any writer — API route, workflow node, importer, raw SQL — invalidates.
// Rolled-back transactions never un-bump a version (it lives in JS), and tables written inside a
// still-open transaction are not cached until a call outside any transaction has purged them.

const TRACKED = ['characters', 'relationships', 'documents', 'terms', 'speech_rules', 'story_events'] as const;
type Tracked = (typeof TRACKED)[number] | 'order';

interface Tracker {
  versions: Map<string, number>;
  entries: Map<string, { signature: string; value: unknown }>;
  /** Tables written while a transaction was open; their cached data may belong to a rollback. */
  dirty: Set<string>;
  /** Triggers were created inside a transaction and may have been rolled back with it. */
  unverified: boolean;
  client: { inTransaction: boolean; exec(sql: string): unknown; prepare(sql: string): { pluck(): { get(): unknown } } };
}
const trackers = new WeakMap<object, Tracker | null>();

function clientOf(db: Db) {
  const handle = db as unknown as { $client?: Tracker['client']; session?: { client?: Tracker['client'] } };
  return handle.$client ?? handle.session?.client ?? null;
}

function install(tracker: Tracker) {
  const sql = TRACKED.flatMap((table) => ['insert', 'update', 'delete'].map((op) => trigger(table, table, op)))
    .concat(['insert', 'delete', 'update of sort, group_id, key, project_id'].map((op) => trigger('units', 'order', op)))
    .concat(['insert', 'delete', 'update of sort'].map((op) => trigger('"groups"', 'order', op)));
  tracker.client.exec(sql.join('\n'));
}
const trigger = (table: string, name: string, op: string) =>
  `create temp trigger if not exists tw_${name.replace(/\W/g, '')}_${op.replace(/\W+/g, '_')} after ${op} on main.${table} begin select tw_bump('${name}'); end;`;

function trackerOf(db: Db): Tracker | null {
  const client = clientOf(db);
  if (!client) return null;
  let tracker = trackers.get(client);
  if (tracker === undefined) {
    try {
      tracker = { versions: new Map(), entries: new Map(), dirty: new Set(), unverified: false, client };
      const owner = tracker;
      (client as unknown as { function(name: string, fn: (table: string) => number): void }).function('tw_bump', (table: string) => {
        owner.versions.set(table, (owner.versions.get(table) ?? 0) + 1);
        if (owner.client.inTransaction) owner.dirty.add(table);
        return 0;
      });
      owner.unverified = client.inTransaction;
      install(owner);
    } catch {
      tracker = null;
    }
    trackers.set(client, tracker);
  }
  if (!tracker) return null;
  const outside = !tracker.client.inTransaction;
  if (tracker.unverified) {
    const present = Number(tracker.client.prepare("select count(*) from sqlite_temp_master where name like 'tw\\_%' escape '\\'").pluck().get());
    if (present < TRACKED.length * 3) {
      install(tracker);
      for (const table of [...TRACKED, 'order']) tracker.versions.set(table, (tracker.versions.get(table) ?? 0) + 1);
      tracker.entries.clear();
    }
    if (outside) tracker.unverified = false;
  }
  if (outside && tracker.dirty.size) {
    for (const table of tracker.dirty) tracker.versions.set(table, (tracker.versions.get(table) ?? 0) + 1);
    tracker.dirty.clear();
  }
  return tracker;
}

/** Cached `load()` for one project, valid while none of `tables` was written. Treat the result as read-only. */
export function cachedKnowledge<T>(db: Db, projectId: string, name: string, tables: Tracked[], load: () => T): T {
  const tracker = trackerOf(db);
  if (!tracker || tables.some((table) => tracker.dirty.has(table))) return load();
  const signature = tables.map((table) => tracker.versions.get(table) ?? 0).join('.');
  const key = `${projectId}|${name}`;
  const hit = tracker.entries.get(key);
  if (hit && hit.signature === signature) return hit.value as T;
  const value = load();
  tracker.entries.set(key, { signature, value });
  return value;
}

/** Cached whole-table reads for one project, shared by context building and workflow function nodes. */
export function knowledgeOf(db: Db, projectId: string) {
  const confirmed = <T extends { status: string }>(rows: T[]) => rows.filter((row) => row.status === 'confirmed');
  return {
    /** Confirmed terms with a matcher over their sources. */
    terms: () =>
      cachedKnowledge(db, projectId, 'terms', ['terms'], () => {
        const rows = db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), eq(s.terms.status, 'confirmed'))).all();
        return { rows, matcher: termMatcher(rows, (term) => term.source) };
      }),
    /** Confirmed terms that have a translation, with a matcher: what a translation must contain. */
    glossary: () =>
      cachedKnowledge(db, projectId, 'glossary', ['terms'], () => {
        const rows = db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), eq(s.terms.status, 'confirmed'))).all().filter((term) => term.target.trim());
        return { rows, matcher: termMatcher(rows, (term) => term.source) };
      }),
    /** Confirmed characters with a matcher over names and aliases. */
    characters: () =>
      cachedKnowledge(db, projectId, 'characters', ['characters'], () => {
        const rows = confirmed(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all());
        return { rows, matcher: termMatcher(rows, (character) => [character.name, ...character.aliases]) };
      }),
    /** Every character, whatever its status (for matching names a writer must not duplicate). */
    allCharacters: () => cachedKnowledge(db, projectId, 'allCharacters', ['characters'], () => db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all()),
    allTermSources: () => cachedKnowledge(db, projectId, 'termSources', ['terms'], () => db.select({ source: s.terms.source }).from(s.terms).where(eq(s.terms.projectId, projectId)).all().map((term) => term.source)),
    allRelationships: () => cachedKnowledge(db, projectId, 'relationships', ['relationships'], () => db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all()),
    allSpeechRules: () => cachedKnowledge(db, projectId, 'speechRules', ['speech_rules'], () => db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all()),
    eventTitles: () => cachedKnowledge(db, projectId, 'eventTitles', ['story_events'], () => db.select({ title: s.storyEvents.title }).from(s.storyEvents).where(eq(s.storyEvents.projectId, projectId)).all().map((row) => row.title)),
    alwaysDocuments: () =>
      cachedKnowledge(db, projectId, 'alwaysDocuments', ['documents'], () =>
        db.select({ kind: s.documents.kind, title: s.documents.title, body: s.documents.body }).from(s.documents).where(and(eq(s.documents.projectId, projectId), eq(s.documents.alwaysInclude, true), eq(s.documents.status, 'confirmed'))).all(),
      ),
    relationships: () => cachedKnowledge(db, projectId, 'confirmedRelationships', ['relationships'], () => confirmed(db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all())),
  };
}

/** The dialogue graph's "certainly passed" order; rule intervals are picked by it (DESIGN 3.2). */
/** The project's dialogue-graph order, built once and kept while the script order is unchanged. */
export const graphOrder = (db: Db, projectId: string) => cachedKnowledge(db, projectId, 'graphOrder', ['order'], () => buildGraphOrder(db, projectId));

/** Script order of every line (scene order, then line order): rule intervals fall back to it for lines outside the graph. */
function scriptOrder(db: Db, projectId: string) {
  return cachedKnowledge(db, projectId, 'scriptOrder', ['order'], () => {
    const rows = db
      .select({ key: s.units.key, seq: s.units.seq })
      .from(s.units)
      .where(eq(s.units.projectId, projectId))
      .all();
    return new Map(rows.map((row) => [row.key, row.seq]));
  });
}

/** The rule for one line; `byOrder` when script order picked its stretch, `routeDependent` when the graph could not because routes differ. */
export interface Resolved {
  listener: string;
  rule: Rule;
  byOrder: boolean;
  routeDependent?: true;
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
        const list = byPair.get(`${norm(line.speaker)}|${norm(listener)}`);
        if (!list?.length) continue;
        const base = list.filter((rule) => !rule.startKey).at(-1);
        const starts = list.filter((rule) => rule.startKey);
        if (!starts.length || !graph) {
          if (base) result.set(line.key, { listener, rule: base, byOrder: false });
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
          if (rule) result.set(line.key, { listener, rule, byOrder: true });
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
          if (rule) result.set(line.key, { listener, rule, byOrder: true, routeDependent: true });
          continue;
        }
        const rule = latest ?? base;
        if (rule) result.set(line.key, { listener, rule, byOrder: false });
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

/** "해요체", "해체": the level name without its 반말 hint. */
const levelName = (level: SpeechLevel) => SPEECH_LEVEL_LABELS[level].replace(/\(.*\)/u, '');
const politenessLabel = (level: SpeechLevel, politeness: Politeness) => `${politeness === 'polite' ? '존댓말' : '반말'}(${levelName(level)})`;

/**
 * Does the translation end on the rule's side of 존댓말/반말? Only those two axes are compared:
 * speakers mix neighbouring levels (해체 with "-다", 해요체 with 하십시오체). Null when the ending
 * cannot be guessed from the text.
 */
export function speechMismatch(rule: Rule, translation: string | null): string | null {
  if (!translation || rule.level === 'other') return null;
  const wanted = politenessOfLevel(rule.level);
  const guessed = speechLevelOf(translation);
  const actual = politenessOfLevel(guessed);
  if (!wanted || !guessed || !actual || wanted === actual) return null;
  // "-ㅂ시다/읍시다" (let's) is also how a 반말 speaker proposes things in official translations.
  if (wanted === 'plain' && guessed === 'hasipsio' && /시다[\s.,!?…~"'”’)\]]*$/u.test(translation.replace(/<[^>]+>|\{[^}]*\}/g, '').trim())) return null;
  return `말투 규칙은 ${politenessLabel(rule.level, wanted)}인데 번역은 ${politenessLabel(guessed, actual)}로 끝납니다(어미로 추정).`;
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
  return { count: rows.length, routeDependent, unitIds: rows.map((line) => line.id), translatedIds, levels, rows: rows.slice(0, 100).map(({ listenerOrigin: _o, listenerConfidence: _c, ...line }) => line) };
}
