import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { CONTEXT_PRIORITY, contextConfigSchema, estimateTokens, listenerLabel, mentions, styleInstruction, termMatcher, type ContextConfig, type ContextItem, type ContextItemKind } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { documents as documentsTable, graphEdges, graphNodes, groups, units } from '../db/schema.ts';
import { cachedKnowledge, describeRule, knowledgeOf, knownListener, speechRuleIndex } from './speech.ts';
import { deriveSceneEdges } from './scene-graph.ts';

export { mentions } from '@tw/shared';

export interface LineContext {
  key: string;
  speaker: string | null;
  source: string;
  translation?: string | null;
}

/**
 * What came before a line. `lines` is the single path right before it (oldest first). Where
 * several paths join, the player came through only one of them: each is a branch of its own,
 * never mixed into one conversation.
 */
export interface Preceding {
  lines: LineContext[];
  branches: { label: string; lines: LineContext[] }[];
  /** Paths that join here beyond the ones shown. */
  moreBranches: number;
}

export interface BatchContext {
  /** Per group id in the batch: its title always, its description when the budget kept it. A batch can span several scenes. */
  scenes: Record<string, { title: string; description?: string }>;
  previousScenes: { title: string; description: string }[];
  documents: { kind: string; title: string; body: string }[];
  characters: { name: string; aliases: string[]; profile: string }[];
  /** Per speaker in the batch whose written style (문체) a person chose: the style as an instruction. */
  voices: Record<string, string>;
  /** Per unit id: who the line is addressed to and the confirmed speech rule for that pair. */
  speech: Record<string, { listener: string; rule?: string; note?: string; byOrder?: true }>;
  /** Every confirmed character, for naming people who are not mentioned in the batch. */
  cast: { name: string; aliases: string[]; player?: true }[];
  relationships: { from: string; to: string; kind: string; description: string; mutual: boolean }[];
  /**
   * Items AI confirmed that no person has looked at (✦, docs/DESIGN.md 3.5), kept apart from the facts above
   * so the model does not take a guess for a settled fact.
   */
  aiNotes: {
    characters: { name: string; aliases: string[]; profile: string }[];
    relationships: { from: string; to: string; kind: string; description: string; mutual: boolean }[];
    documents: { kind: string; title: string; body: string }[];
  };
  terms: { source: string; target: string; note: string }[];
  /** Per unit id, only for lines whose preceding lines are not already in the batch or shown for an earlier line. */
  preceding: Record<string, Preceding>;
  /** Everything considered, in fill order, with what was dropped for the cap. */
  items: ContextItem[];
  budget: { limit: number; used: number };
}

const MAX_BRANCHES = 4;

/**
 * Words that name nobody in particular. An AI-made profile often lists them as aliases ("Player" aka "you"),
 * and they would pull that character into nearly every batch. A character's own name is not filtered.
 */
const GENERIC_ALIASES = new Set([
  'you', 'your', 'yours', 'yourself', 'i', 'me', 'my', 'mine', 'myself', 'he', 'him', 'his', 'she', 'her', 'hers', 'they', 'them', 'their', 'we', 'us', 'our',
  'it', 'its', 'one', 'sir', 'madam', 'ma\'am', 'miss', 'mister', 'mr', 'mrs', 'ms', 'boss', 'chief', 'man', 'woman', 'guy', 'girl', 'boy', 'kid', 'child', 'dude', 'buddy',
  'friend', 'stranger', 'everyone', 'everybody', 'someone', 'somebody', 'anyone', 'anybody', 'nobody', 'player', 'user', 'hero', 'protagonist', 'narrator', 'speaker', 'listener',
]);
const MIN_ALIAS_LENGTH = 3;

/** Whether an alias may trigger character matching: not a common word and at least three characters. */
export const usableAlias = (alias: string) => {
  const word = alias.trim().toLowerCase();
  return word.length >= MIN_ALIAS_LENGTH && !GENERIC_ALIASES.has(word);
};

const matchers = new WeakMap<object, ReturnType<typeof termMatcher<{ name: string; aliases: string[] }>>>();
/** The confirmed-character matcher with generic aliases left out; cached with the (read-only, cached) rows. */
function mentionMatcher<T extends { name: string; aliases: string[] }>(rows: T[]) {
  let matcher = matchers.get(rows);
  if (!matcher) matchers.set(rows, (matcher = termMatcher(rows, (character) => [character.name, ...character.aliases.filter(usableAlias)])));
  return matcher as ReturnType<typeof termMatcher<T>>;
}

/** An item AI confirmed that no person has looked at yet (✦). */
const unverified = (row: { statusBy: string }) => row.statusBy === 'ai';

interface Incoming {
  from: string;
  label: string | null;
}

/** Unit ids before a unit, nearest first; branches where paths join. */
interface PrecedingIds {
  lines: string[];
  branches: { labels: string[]; units: string[] }[];
  moreBranches: number;
}

/** The source graph never changes after import, so its adjacency is built once per project. */
class GraphIndex {
  nodeOfUnit = new Map<string, { nodeId: string; position: number }>();
  unitsOfNode = new Map<string, string[]>();
  incoming = new Map<string, Incoming[]>();
  previousScenes = new Map<string, string[]>();

  constructor(db: Db, projectId: string) {
    const nodes = db.select({ id: graphNodes.id, groupId: graphNodes.groupId, unitIds: graphNodes.unitIds }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all();
    const edges = db.select({ fromId: graphEdges.fromId, toId: graphEdges.toId, label: graphEdges.label }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all();
    for (const node of nodes) {
      this.unitsOfNode.set(node.id, node.unitIds);
      node.unitIds.forEach((unitId, position) => {
        if (!this.nodeOfUnit.has(unitId)) this.nodeOfUnit.set(unitId, { nodeId: node.id, position });
      });
    }
    for (const edge of edges) {
      const list = this.incoming.get(edge.toId);
      const entry = { from: edge.fromId, label: edge.label };
      if (list) list.push(entry);
      else this.incoming.set(edge.toId, [entry]);
    }
    const scenes = new Set(db.select({ id: groups.id }).from(groups).where(and(eq(groups.projectId, projectId), eq(groups.kind, 'scene'))).all().map((group) => group.id));
    const sceneNodes = nodes.map((node) => ({ id: node.id, groupId: node.groupId && scenes.has(node.groupId) ? node.groupId : null }));
    for (const edge of deriveSceneEdges(sceneNodes, edges)) {
      const list = this.previousScenes.get(edge.to);
      if (list) list.push(edge.from);
      else this.previousScenes.set(edge.to, [edge.from]);
    }
  }

  /**
   * Walks back from `from` while there is exactly one way in, collecting lines nearest first.
   * Stops at the limit, at a start node, at a node already walked, or where paths join.
   */
  private walk(from: string, limit: number, seen: Set<string>, units: string[], labels: string[]): Incoming[] {
    let current = from;
    for (;;) {
      const ways = this.incoming.get(current) ?? [];
      if (units.length >= limit || ways.length !== 1) return ways;
      const [way] = ways;
      if (seen.has(way.from)) return [];
      seen.add(way.from);
      if (way.label) labels.push(way.label);
      units.push(...[...(this.unitsOfNode.get(way.from) ?? [])].reverse());
      current = way.from;
    }
  }

  precedingUnitIds(unitId: string, limit: number): PrecedingIds | null {
    const start = this.nodeOfUnit.get(unitId);
    if (!start) return null;
    const lines = this.unitsOfNode.get(start.nodeId)!.slice(0, start.position).reverse();
    const seen = new Set([start.nodeId]);
    const joining = this.walk(start.nodeId, limit, seen, lines, []);
    if (lines.length >= limit || joining.length < 2) return { lines: lines.slice(0, limit), branches: [], moreBranches: 0 };
    // Paths join here: follow each one on its own, splitting again where they join further back.
    // A loop back into this line is one of the paths (the player may have come round again).
    const room = limit - lines.length;
    const branches: PrecedingIds['branches'] = [];
    let moreBranches = 0;
    const open = [{ ways: joining, labels: [] as string[], units: [] as string[], seen }];
    while (open.length) {
      const path = open.shift()!;
      const fresh = path.ways.filter((way) => !path.seen.has(way.from));
      if (!fresh.length && path.units.length) branches.push({ labels: path.labels, units: path.units });
      for (const way of fresh) {
        if (branches.length + open.length >= MAX_BRANCHES) {
          moreBranches += 1;
          continue;
        }
        const next = { labels: way.label ? [...path.labels, way.label] : [...path.labels], units: [...path.units, ...[...(this.unitsOfNode.get(way.from) ?? [])].reverse()], seen: new Set([...path.seen, way.from]) };
        const rest = this.walk(way.from, room, next.seen, next.units, next.labels);
        if (next.units.length < room && rest.length > 1) open.push({ ...next, ways: rest });
        else branches.push({ labels: next.labels, units: next.units.slice(0, room) });
      }
    }
    // Labels were collected walking backwards; show them in story order.
    return { lines, branches: branches.map((branch) => ({ labels: [...branch.labels].reverse(), units: branch.units })), moreBranches };
  }
}

const indexes = new Map<string, GraphIndex>();
const graphIndex = (db: Db, projectId: string) => {
  let index = indexes.get(projectId);
  if (!index) indexes.set(projectId, (index = new GraphIndex(db, projectId)));
  return index;
};
export const forgetProjectContext = (projectId: string) => indexes.delete(projectId);

/** A candidate piece of context and how to keep it if it fits. */
interface Candidate {
  item: Omit<ContextItem, 'tokens' | 'included'>;
  payload: unknown;
  keep: () => void;
}

export function buildContext(
  db: Db,
  projectId: string,
  batch: { id: string; key: string; groupId: string; sort: number; speaker: string | null; source: string }[],
  stored: Partial<ContextConfig>,
): BatchContext {
  // Saved workflows may predate a setting; the schema fills its default.
  const config = contextConfigSchema.parse(stored ?? {});
  const index = graphIndex(db, projectId);
  const knowledge = knowledgeOf(db, projectId);
  const text = batch.map((unit) => `${unit.speaker ?? ''}\n${unit.source}`).join('\n');
  const groupIds = [...new Set(batch.map((unit) => unit.groupId))];
  const sceneRows = db.select().from(groups).where(inArray(groups.id, groupIds)).all();
  const result: BatchContext = { scenes: Object.fromEntries(sceneRows.map((row) => [row.id, { title: row.title }])), previousScenes: [], documents: [], characters: [], cast: [], relationships: [], aiNotes: { characters: [], relationships: [], documents: [] }, terms: [], speech: {}, voices: {}, preceding: {}, items: [], budget: { limit: config.maxTokens, used: 0 } };
  const candidates: Record<ContextItemKind, Candidate[]> = { term: [], speech: [], cast: [], preceding: [], character: [], relationship: [], scene: [], previousScene: [], document: [] };

  // '사람이 확정한 것만': AI-confirmed terms and knowledge stay out of this node's prompt.
  const trusted = (row: { statusBy: string }) => !config.humanOnly || !unverified(row);
  if (config.glossary) {
    const used = knowledge.terms().matcher.find(text).filter(trusted).map(({ source, target, note }) => ({ source, target, note }));
    const reason = config.humanOnly ? '원문에 나오는 사람이 확정한 용어' : '원문에 나오는 확정 용어';
    for (const term of used) candidates.term.push({ item: { kind: 'term', label: `${term.source} → ${term.target}`, reason }, payload: term, keep: () => result.terms.push(term) });
  }

  if (config.precedingLines > 0) {
    const batchKeys = new Set(batch.map((unit) => unit.key));
    const shown = new Set<string>();
    const wanted = new Map<string, { ids: PrecedingIds; fromGraph: boolean }>();
    for (const unit of batch) {
      const fromGraph = index.precedingUnitIds(unit.id, config.precedingLines);
      const ids =
        fromGraph ??
        ({
          lines: db
            .select({ id: units.id })
            .from(units)
            .where(and(eq(units.groupId, unit.groupId), lt(units.sort, unit.sort)))
            .orderBy(desc(units.sort))
            .limit(config.precedingLines)
            .all()
            .map((row) => row.id),
          branches: [],
          moreBranches: 0,
        } satisfies PrecedingIds);
      wanted.set(unit.id, { ids, fromGraph: Boolean(fromGraph) });
    }
    const all = [...new Set([...wanted.values()].flatMap(({ ids }) => [...ids.lines, ...ids.branches.flatMap((branch) => branch.units)]))];
    const rows = new Map(
      all.length
        ? db.select({ id: units.id, key: units.key, speaker: units.speaker, source: units.source, translation: units.translation }).from(units).where(inArray(units.id, all)).all().map((row) => [row.id, row])
        : [],
    );
    // Oldest first; lines in the batch are visible in order, and a line shown once is not repeated.
    const lineOf = (ids: string[]) =>
      ids
        .map((id) => rows.get(id))
        .filter((row) => row !== undefined && !batchKeys.has(row.key) && !shown.has(row.key))
        .map((row) => ({ key: row!.key, speaker: row!.speaker, source: row!.source, ...(config.precedingTranslations && { translation: row!.translation }) }))
        .reverse();
    for (const unit of batch) {
      const { ids, fromGraph } = wanted.get(unit.id)!;
      const preceding: Preceding = {
        lines: lineOf(ids.lines),
        branches: ids.branches.map((branch, at) => ({ label: branch.labels.join(' › ') || `갈래 ${at + 1}`, lines: lineOf(branch.units) })).filter((branch) => branch.lines.length),
        moreBranches: ids.moreBranches,
      };
      if (!preceding.lines.length && !preceding.branches.length) continue;
      for (const line of [...preceding.lines, ...preceding.branches.flatMap((branch) => branch.lines)]) shown.add(line.key);
      const count = preceding.lines.length + preceding.branches.reduce((sum, branch) => sum + branch.lines.length, 0);
      const reason = !fromGraph
        ? '대사 그래프에 없어 장면 순서로 찾음'
        : preceding.branches.length
          ? `대사 그래프상 앞. 갈래 ${preceding.branches.length + preceding.moreBranches}개가 합쳐지는 곳이라 갈래별로 나눔${preceding.moreBranches ? ` (${preceding.moreBranches}개 생략)` : ''}`
          : '대사 그래프상 바로 앞 (한 갈래)';
      candidates.preceding.push({ item: { kind: 'preceding', label: `${unit.key} 앞 ${count}줄`, reason }, payload: preceding, keep: () => (result.preceding[unit.id] = preceding) });
    }
  }

  if (config.speech) {
    const lines = db
      .select({ id: units.id, key: units.key, groupId: units.groupId, speaker: units.speaker, listener: units.listener, listenerOrigin: units.listenerOrigin, listenerConfidence: units.listenerConfidence })
      .from(units)
      .where(inArray(units.id, batch.map((unit) => unit.id)))
      .all();
    const rules = speechRuleIndex(db, projectId).resolve(lines);
    // "group" names who is there: the other speakers of the scene.
    const present = lines.some((line) => knownListener(line) === 'group') ? speakersOf(db, [...new Set(lines.map((line) => line.groupId))]) : new Map<string, string[]>();
    const told = (line: (typeof lines)[number], listener: string) =>
      listener === 'group'
        ? `everyone present${(present.get(line.groupId) ?? []).filter((name) => name !== line.speaker).length ? ` (${(present.get(line.groupId) ?? []).filter((name) => name !== line.speaker).slice(0, 8).join(', ')})` : ''}`
        : listener === 'public'
          ? 'the public (an unspecified audience)'
          : listener === 'self'
            ? 'self (thinking aloud)'
            : listener;
    for (const line of lines) {
      const listener = knownListener(line);
      if (!listener) continue;
      const resolved = rules.get(line.key);
      const found = resolved && trusted(resolved.rule) ? resolved : undefined;
      const entry = { listener: told(line, listener), ...(found && { rule: describeRule(found.rule), ...(found.rule.note && { note: found.rule.note }), ...(found.byOrder && { byOrder: true as const }) }) };
      candidates.speech.push({
        item: { kind: 'speech', label: `${line.key}: ${line.speaker ?? '?'} → ${listenerLabel(listener)}${found ? ` · ${describeRule(found.rule)}` : ''}`, reason: found ? `${config.humanOnly ? '사람이 확정한' : '확정'} 말투 규칙${found.routeDependent ? ' (구간 시작을 거쳤는지가 루트에 따라 달라 대본 순서 기준)' : found.byOrder ? ' (그래프 밖이라 구간은 대본 순서 기준)' : ''}` : resolved ? '청자만 (이 쌍의 규칙은 AI가 확정해 뺌)' : '청자만 (이 쌍의 확정 규칙 없음)' },
        payload: entry,
        keep: () => (result.speech[line.id] = entry),
      });
    }
  }

  if (config.cast) {
    const cast = knowledge.characters().rows.filter(trusted).map(({ name, aliases, player }) => ({ name, aliases, ...(player ? { player: true as const } : {}) }));
    if (cast.length) candidates.cast.push({ item: { kind: 'cast', label: `${cast.length}명`, reason: config.humanOnly ? '사람이 확정한 인물 전체 (이름·별칭·플레이어 여부)' : '확정된 인물 전체 (이름·별칭·플레이어 여부)' }, payload: cast, keep: () => (result.cast = cast) });
  }

  // How the batch's speakers talk goes with how they address each other: the style a person chose
  // for a speaker (문체), one short line per name, whenever speech is on (characters may be off).
  if (config.speech) {
    const speakers = new Set(batch.flatMap((unit) => (unit.speaker ? [unit.speaker.toLowerCase()] : [])));
    for (const character of knowledge.characters().rows.filter(trusted)) {
      const style = styleInstruction(character.style);
      if (style && [character.name, ...character.aliases].some((name) => speakers.has(name.toLowerCase()))) result.voices[character.name] = style;
    }
  }

  const confirmedCast = config.characters || config.relationships ? knowledge.characters() : null;
  const allCharacters = confirmedCast?.rows ?? [];
  const present = confirmedCast ? mentionMatcher(confirmedCast.rows).find(text) : [];
  if (config.characters)
    for (const character of present.filter(trusted)) {
      const { name, aliases, profile } = character;
      const entry = { name, aliases, profile };
      const via = [name, ...aliases.filter(usableAlias)].find((alias) => mentions(text, alias));
      const ai = unverified(character);
      candidates.character.push({
        item: { kind: 'character', label: ai ? `${name} (AI 추론)` : name, reason: `화자·원문에 이름이 나옴: ${via}${ai ? ' · 확인 안 된 AI 항목이라 사실과 따로 전달' : ''}` },
        payload: entry,
        keep: () => (ai ? result.aiNotes.characters : result.characters).push(entry),
      });
    }
  if (config.relationships) {
    const presentIds = new Set(present.map((character) => character.id));
    const nameOf = new Map(allCharacters.map((character) => [character.id, character.name]));
    const rels = knowledge.relationships().filter((rel) => presentIds.has(rel.fromId) && presentIds.has(rel.toId) && trusted(rel));
    for (const rel of rels) {
      const entry = { from: nameOf.get(rel.fromId)!, to: nameOf.get(rel.toId)!, kind: rel.kind, description: rel.description, mutual: rel.mutual };
      const ai = unverified(rel);
      candidates.relationship.push({
        item: { kind: 'relationship', label: `${entry.from} → ${entry.to}: ${entry.kind}${ai ? ' (AI 추론)' : ''}`, reason: `이 묶음에 나오는 두 인물 사이${ai ? ' · 확인 안 된 AI 항목이라 사실과 따로 전달' : ''}` },
        payload: entry,
        keep: () => (ai ? result.aiNotes.relationships : result.relationships).push(entry),
      });
    }
  }

  for (const row of sceneRows)
    if (row.description.trim())
      candidates.scene.push({
        item: { kind: 'scene', label: row.title, reason: sceneRows.length > 1 ? '이 묶음에 든 장면 (설명)' : '이 묶음의 장면 (설명)' },
        payload: row.description,
        keep: () => (result.scenes[row.id] = { title: row.title, description: row.description }),
      });

  if (config.previousScenes > 0) {
    const ids = [...new Set(groupIds.flatMap((id) => index.previousScenes.get(id) ?? []))].filter((id) => !groupIds.includes(id)).slice(0, config.previousScenes);
    const rows = ids.length ? db.select({ title: groups.title, description: groups.description }).from(groups).where(inArray(groups.id, ids)).all() : [];
    for (const scene of rows)
      candidates.previousScene.push({ item: { kind: 'previousScene', label: scene.title, reason: '대사 그래프에서 파생한 장면 연결상 바로 앞' }, payload: scene, keep: () => result.previousScenes.push(scene) });
  }

  if (config.documents) {
    const rows = cachedKnowledge(db, projectId, 'alwaysDocumentsWithStatusBy', ['documents'], () =>
      db
        .select({ kind: documentsTable.kind, title: documentsTable.title, body: documentsTable.body, statusBy: documentsTable.statusBy })
        .from(documentsTable)
        .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.alwaysInclude, true), eq(documentsTable.status, 'confirmed')))
        .all(),
    );
    for (const { statusBy, ...doc } of rows) {
      if (!trusted({ statusBy })) continue;
      const ai = unverified({ statusBy });
      candidates.document.push({
        item: { kind: 'document', label: ai ? `${doc.title} (AI 추론)` : doc.title, reason: `‘번역 문맥에 넣기’를 켠 문서 (전문)${ai ? ' · 확인 안 된 AI 항목이라 사실과 따로 전달' : ''}` },
        payload: doc,
        keep: () => (ai ? result.aiNotes.documents : result.documents).push(doc),
      });
    }
  }

  // Fill in priority order; whatever does not fit is dropped and recorded, never silently lost.
  for (const kind of CONTEXT_PRIORITY)
    for (const candidate of candidates[kind]) {
      const tokens = estimateTokens(candidate.payload);
      const included = result.budget.used + tokens <= result.budget.limit;
      if (included) {
        result.budget.used += tokens;
        candidate.keep();
      }
      result.items.push({ ...candidate.item, tokens, included });
    }
  return result;
}

/** Speakers of each scene, in order of first line: who a "group" listener means. */
function speakersOf(db: Db, groupIds: string[]) {
  const rows = db.select({ groupId: units.groupId, speaker: units.speaker }).from(units).where(inArray(units.groupId, groupIds)).orderBy(units.seq).all();
  const result = new Map<string, string[]>();
  for (const row of rows) if (row.speaker) (result.get(row.groupId) ?? result.set(row.groupId, []).get(row.groupId)!).push(row.speaker);
  for (const [groupId, list] of result) result.set(groupId, [...new Set(list)]);
  return result;
}
