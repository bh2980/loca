import { createHash } from 'node:crypto';
import { markForReview } from './knowledge-tags.ts';
import { and, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { aiStatus, DEFAULT_AI_CONFIRM, isSpecialListener, SPEECH_LEVEL_GUIDE, SPEECH_LEVEL_LABELS, SPEECH_LEVELS, TERM_KIND_LABELS, TERM_KINDS, type AiConfirm, type AiConfirmKind, type ModelChoice } from '@tw/shared';
import { aiConfirmOf } from './status-by.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { logged } from './ai-calls.ts';
import type { ModelPort } from '../engine/runner.ts';
import { liveChoice, resolveRoutes } from './routes.ts';
import { packBlocks, scriptText } from './script-text.ts';
import { knownListener } from './speech.ts';
import type { SecretStore } from './secrets.ts';

/**
 * Parts above this many estimated tokens are split at scene boundaries. Long-context models read
 * a whole game in one call (a 2,700-line game ≈ 80k), which the experiments found as accurate as reading in
 * parts and five times cheaper; splitting is only for scripts larger than the model's window.
 */
export const ANALYSIS_PART_TOKENS = 300_000;
/** The answer was cut off at the model's output limit (an API's finishReason length, a CLI saying so). */
export function outputCutOff(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /output token limit|exceeded the (?:maximum )?output|finishReason: length|max_?tokens|response was cut off/i.test(message);
}

/** A part split in two at a scene boundary (each scene block starts with "## "); null for a single scene. */
export function splitPart(part: string): [string, string] | null {
  const blocks = part.split(/\n\n(?=## )/);
  if (blocks.length < 2) return null;
  const total = part.length;
  let size = 0;
  let cut = 1;
  for (; cut < blocks.length - 1 && size + blocks[cut - 1].length < total / 2; cut++) size += blocks[cut - 1].length;
  return [blocks.slice(0, cut).join('\n\n'), blocks.slice(cut).join('\n\n')];
}

/** A whole-script read takes minutes; the connection's per-call timeout is for single scenes. */
const MIN_TIMEOUT_MS = 30 * 60_000;

const ids = z.array(z.string()).default([]);
export const analysisSchema = z.object({
  overview: z.object({ setting: z.string().default(''), mainConflict: z.string().default(''), plot: z.string().default(''), evidence: ids }),
  characters: z.array(z.object({ name: z.string().min(1), aliases: z.array(z.string()).default([]), profile: z.string().default(''), speech: z.string().default(''), player: z.boolean().default(false), evidence: ids })).default([]),
  relationships: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        kind: z.string().min(1),
        description: z.string().default(''),
        changes: z.array(z.object({ at: z.string(), change: z.string(), cause: z.string().default('') })).default([]),
        evidence: ids,
      }),
    )
    .default([]),
  events: z.array(z.object({ title: z.string().min(1), summary: z.string().default(''), cause: z.string().default(''), outcome: z.string().default(''), participants: z.array(z.string()).default([]), evidence: ids })).default([]),
  speechRules: z
    .array(z.object({ from: z.string().min(1), to: z.string().min(1), level: z.enum(SPEECH_LEVELS), address: z.string().default(''), note: z.string().default(''), start: z.string().nullable().default(null), evidence: ids }))
    .default([]),
  /** Names and words whose Korean form must stay the same everywhere: they become glossary candidates. */
  terms: z
    .array(z.object({ source: z.string().min(1), kind: z.enum(TERM_KINDS).catch('other'), meaning: z.string().default(''), target: z.string().default(''), evidence: ids }))
    .default([]),
  /**
   * Per scene, whom each speaker mostly addresses (lines inherit it unless their listener is known),
   * plus the speaker's lines there that address someone else: a whole scene at the cost of its exceptions.
   */
  sceneListeners: z
    .array(
      z.object({
        scene: z.string().min(1),
        speaker: z.string().min(1),
        listener: z.string().nullable(),
        confidence: z.number().min(0).max(1).default(0.5),
        exceptions: z.array(z.object({ line: z.string().min(1), listener: z.string().nullable(), confidence: z.number().min(0).max(1).default(0.5) })).default([]),
      }),
    )
    .default([]),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const SYSTEM = `You are reading the complete script of a game so that translators into Korean get the background they need.
Script format: "## <section> — <scene> [<scene key>]" headers; lines "L<n> <Speaker>: <text>"; "[문서]" and "[UI]" are in-game documents and interface text; "▶ <label>" before a line means it follows that player choice or condition. Lines after different choices are alternatives, never one conversation.

Rules:
- Use only what the text says. Do NOT use prior knowledge of this game.
- Every item cites evidence as line ids like ["L120","L131"].
- Write in Korean, except names and quoted source words.
- characters: everyone who speaks or is addressed often. "speech" describes how they talk in the source. Mark the player character (the one the player controls or who is addressed as "you" by the game, even if it never speaks) with "player": true. Name everyone as the source does, in the source language; an unnamed player character gets the role the game uses (e.g. "Detective", "Captain"), never a translated name.
- relationships: one per direction that matters; "changes" give the line id ("at") where the relationship changes and why.
- events: what happened, its cause and its outcome, the people involved; include events that later lines refer back to.
- speechRules: for every speaker → listener direction with several lines (the listener may also be "group", "public" or "self" as in sceneListeners: how the speaker talks to several people present, to an unspecified audience, or to themself), the Korean speech level the translation should use, one of: ${SPEECH_LEVEL_GUIDE}. Decide from the relationship (age, rank, intimacy, hostility, era and setting) as a Korean translator would; narration-like or written addresses often take 해라체, close friends 해체. "address" is how the speaker should address the listener in Korean (e.g. "수사관님", "언니"); when several forms are used, separate them with commas (e.g. "행크 경위님, 경위님"); empty if none. If the level changes at some point (falling out, reconciliation, promotion), give one rule per stretch: "start" is the line id where the new stretch begins (null for the first). Do not mark a single sarcastic or emotional line as a change. "note" says why.
- sceneListeners: for each scene and each speaker in it, whom that speaker mostly addresses there ("scene" is the key in [brackets]; "listener" a character name, or for an extra outside the cast (a SWAT officer, a passer-by) their name exactly as it appears as a speaker; "group" when the speaker addresses several people present at once (a meeting, a group call); "public" for an unspecified audience (a broadcast, announcement, speech, post or advert); "self" for thinking aloud, a diary or muttering; or null when you cannot tell) and your confidence from 0 to 1. In "exceptions", list each line of that speaker in the scene that addresses someone else (an extra, a third person, the group, themself), with its line id, its listener (same names as above) and your confidence; "confidence" then says how sure you are that every OTHER line of that speaker there addresses "listener". Name listeners by name, never by a role ("the negotiator", "the suspect") when the script shows who that is. List exceptions only where the text shows it (a vocative, an order to someone else, an answer to another speaker); do not list a line just because you are unsure. In a group scene where a speaker mostly talks to everyone, "group" is right and the few lines answering one person are exceptions. Skip scenes with a single obvious speaker talking to nobody in particular.
- terms: names and words whose Korean form must stay the same across the whole translation: people, places, organizations, products and technology, coined words and in-world concepts (also lower-case ones, such as a slang word, a species or a drug), ranks and titles, and interface words that recur. Not ordinary words. "source" exactly as the script writes it, "kind" one of ${TERM_KINDS.join(', ')}, "meaning" one short Korean sentence, "target" the Korean form a translator should use (names by Korean loanword convention), "evidence" a few lines where it appears. At most about 150, the most important first.
- Keep the whole answer under about 15,000 words.`;

export const RETURN = 'Return only JSON with "overview", "characters", "relationships", "events", "speechRules", "terms" and "sceneListeners".';

type Job = typeof s.analysisJobs.$inferSelect;

/**
 * Work analysis (작품 분석): a long-context model reads the whole script and drafts the overview,
 * characters, relationships, events and speech rules. With auto-confirm (the default) they are
 * stored confirmed and used as context right away, since nobody reviews hundreds of drafts; a
 * wrong item is fixed later and its lines re-run. Without it they are candidates. Either way the
 * origin stays "ai"; re-running replaces only AI items no person has edited or confirmed.
 */
export class AnalysisService {
  private aborts = new Map<string, AbortController>();

  constructor(
    private db: Db,
    private secrets: SecretStore,
    private model: Pick<ModelPort, 'generate'> = { generate: ai.generate },
    /** Estimated tokens per part; tests pass a small value to get several parts. */
    private partTokens = ANALYSIS_PART_TOKENS,
  ) {
    // A restart cuts off any job in flight.
    db.update(s.analysisJobs).set({ status: 'failed', error: '서버가 다시 시작되어 중단되었습니다.', finishedAt: new Date() }).where(eq(s.analysisJobs.status, 'running')).run();
  }

  list(projectId: string): Job[] {
    return this.db.select().from(s.analysisJobs).where(eq(s.analysisJobs.projectId, projectId)).orderBy(desc(s.analysisJobs.createdAt)).limit(10).all();
  }

  /**
   * Starts an analysis. With `resume`, parts whose script text is unchanged since the latest
   * unfinished (failed or cancelled) job reuse that job's answers, so only the rest is read again.
   */
  start(projectId: string, choice: ModelChoice, resume = false): Job {
    if (this.db.select().from(s.analysisJobs).where(and(eq(s.analysisJobs.projectId, projectId), eq(s.analysisJobs.status, 'running'))).get()) throw new Error('이미 진행 중인 작품 분석이 있습니다.');
    const { snapshot } = liveChoice(this.db, choice, this.secrets, 'generate');
    const { blocks, keyOf } = scriptText(this.db, projectId);
    if (!blocks.length) throw new Error('분석할 대본이 없습니다.');
    const parts = packBlocks(blocks, this.partTokens);
    const previous = resume
      ? this.db.select().from(s.analysisJobs).where(and(eq(s.analysisJobs.projectId, projectId), inArray(s.analysisJobs.status, ['failed', 'cancelled']))).orderBy(desc(s.analysisJobs.createdAt)).limit(1).get()
      : undefined;
    const reused = new Map((previous?.parts ?? []).map((part) => [part.hash, part.answer]));
    const input = { lines: keyOf.size, scenes: blocks.length, tokens: Math.round(Buffer.byteLength(parts.join('\n\n')) / 4) };
    const job = this.db.insert(s.analysisJobs).values({ projectId, connectionId: choice.connectionId, model: choice.model, effort: choice.effort ?? null, status: 'running', partsTotal: parts.length, input }).returning().get();
    const abort = new AbortController();
    this.aborts.set(job.id, abort);
    events.changed(projectId, 'runs', 'analysis');
    this.run(job, snapshot, parts, keyOf, abort.signal, reused)
      .catch((error) => console.error('analysis job failed', error))
      .finally(() => this.aborts.delete(job.id));
    return job;
  }

  cancel(jobId: string) {
    this.aborts.get(jobId)?.abort();
    const job = this.db.update(s.analysisJobs).set({ status: 'cancelled', finishedAt: new Date() }).where(and(eq(s.analysisJobs.id, jobId), eq(s.analysisJobs.status, 'running'))).returning().get();
    if (job) events.changed(job.projectId, 'runs', 'analysis');
  }

  private async run(job: Job, model: s.AiSnapshot, parts: string[], keyOf: Map<string, string>, signal: AbortSignal, reused = new Map<string, unknown>()) {
    const routes = resolveRoutes(model, this.secrets);
    // People a person made or imported (or took over from AI) keep their names: the model must reuse them.
    const kept = this.db.select().from(s.characters).where(eq(s.characters.projectId, job.projectId)).all().filter((c) => c.statusBy === 'human');
    const cast = kept.length
      ? `\n\nKNOWN CHARACTERS (names as stored; the script's speaker names). For these people use exactly these names in every field and put other names they go by in "aliases"; only people not listed here get new names:\n${kept.map((c) => `- ${c.name}${c.aliases.length ? ` (also: ${c.aliases.join(', ')})` : ''}`).join('\n')}`
      : '';
    let merged = null as Analysis | null;
    const usage = { inputTokens: 0, outputTokens: 0 };
    const answers: { hash: string; answer: unknown }[] = [];
    try {
      // Parts the model refuses as longer than its context window, or whose answer was cut off at the
      // model's output limit (a whole game's listeners and terms can be as long as the script), are
      // split in two at a scene boundary and read again.
      const queue = [...parts];
      for (let index = 0; index < queue.length; index++) {
        const part = queue[index];
        const hash = createHash('sha256').update(part).digest('hex');
        const kept = reused.get(hash);
        const parsed = kept ? analysisSchema.safeParse(kept) : null;
        if (parsed?.success) {
          answers.push({ hash, answer: kept });
          merged = merged ? mergeAnalysis(merged, parsed.data) : parsed.data;
          this.db.update(s.analysisJobs).set({ partsDone: index + 1, parts: answers }).where(eq(s.analysisJobs.id, job.id)).run();
          continue;
        }
        const known: string = merged ? `\n\nALREADY KNOWN from earlier parts (reuse these names; return only what this part adds or changes):\n${summarize(merged)}` : '';
        const where = queue.length > 1 ? `\nThis is part ${index + 1} of ${queue.length} of the script, in order.` : '';
        const system = SYSTEM;
        const prompt = `${RETURN}${where}${cast}${known}\n\nSCRIPT:\n${part}`;
        const result = await ai
          .withFallback(
            routes,
            model.maxAttempts,
            (route) =>
              logged(this.db, { projectId: job.projectId, kind: 'analysis', refId: job.id, label: `작품 분석 ${index + 1}/${queue.length}`, request: `${system}\n\n---\n\n${prompt}` }, route, () => this.model.generate<Analysis>(route, {
                system,
                prompt,
                schema: analysisSchema,
                maxOutputTokens: model.maxOutputTokens,
                timeoutMs: Math.max(model.timeoutSeconds * 1000, MIN_TIMEOUT_MS),
                signal,
              })),
            signal,
          )
          .catch((error: unknown) => {
            const halves = (error as { code?: string }).code === 'too-long' || outputCutOff(error) ? splitPart(part) : null;
            if (!halves) throw error;
            return halves;
          });
        if (Array.isArray(result)) {
          queue.splice(index, 1, ...result);
          index--;
          this.db.update(s.analysisJobs).set({ partsTotal: queue.length }).where(eq(s.analysisJobs.id, job.id)).run();
          events.changed(job.projectId, 'runs', 'analysis');
          continue;
        }
        usage.inputTokens += result.result.usage.inputTokens ?? 0;
        usage.outputTokens += result.result.usage.outputTokens ?? 0;
        merged = merged ? mergeAnalysis(merged, result.result.object) : result.result.object;
        if (signal.aborted) return;
        answers.push({ hash, answer: result.result.object });
        this.db.update(s.analysisJobs).set({ partsDone: index + 1, usage, parts: answers }).where(eq(s.analysisJobs.id, job.id)).run();
        events.changed(job.projectId, 'runs', 'analysis');
      }
      if (signal.aborted || !merged) return;
      const counts = saveDrafts(this.db, job.projectId, job.id, merged, keyOf, aiConfirmOf(this.db, job.projectId));
      this.db.update(s.analysisJobs).set({ status: 'completed', result: counts, usage, finishedAt: new Date() }).where(eq(s.analysisJobs.id, job.id)).run();
      // The drafts include term candidates and scene listeners (units), besides the story knowledge.
      events.changed(job.projectId, 'runs', 'analysis', 'knowledge', 'terms', 'units');
    } catch (error) {
      if (signal.aborted) return;
      this.db.update(s.analysisJobs).set({ status: 'failed', error: error instanceof Error ? error.message : String(error), usage, finishedAt: new Date() }).where(eq(s.analysisJobs.id, job.id)).run();
      events.changed(job.projectId, 'runs', 'analysis');
    }
  }
}

/** What later parts need to stay consistent: names and the rules so far. */
function summarize(analysis: Analysis) {
  return [
    ...analysis.characters.map((c) => `- ${c.name}${c.aliases.length ? ` (${c.aliases.join(', ')})` : ''}${c.player ? ' [player]' : ''}`),
    ...analysis.speechRules.map((r) => `- rule ${r.from} → ${r.to}: ${r.level}${r.start ? ` from ${r.start}` : ''}`),
    ...analysis.events.map((e) => `- event: ${e.title}`),
  ].join('\n');
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const namesOf = (c: { name: string; aliases: string[] }) => [c.name, ...c.aliases];

/** A rule a later part contradicts (same pair and start, another level or address): kept as a candidate. */
export type MergedRule = Analysis['speechRules'][number] & { conflict?: true };

/**
 * Adds a later part's findings. A person is the same when any of their names or aliases match; the
 * later part's relationship and rule names are mapped onto the merged person first, so "Holt" and
 * "Mara Holt" do not become two. A rule that disagrees with an earlier one for the same pair and
 * start is kept and marked as a conflict, never dropped silently. Events with the same title merge.
 */
export function mergeAnalysis(base: Analysis, next: Analysis): Analysis {
  const characters = base.characters.map((c) => ({ ...c, aliases: [...c.aliases], evidence: [...c.evidence] }));
  const personOf = (name: string) => characters.find((c) => namesOf(c).some((known) => same(known, name)));
  for (const c of next.characters) {
    const existing = characters.find((old) => namesOf(old).some((name) => namesOf(c).some((other) => same(name, other))));
    if (!existing) characters.push({ ...c });
    else
      Object.assign(existing, {
        aliases: [...new Set([...existing.aliases, ...namesOf(c).filter((name) => !same(name, existing.name))])],
        profile: existing.profile || c.profile,
        speech: existing.speech || c.speech,
        player: existing.player || c.player,
        evidence: [...existing.evidence, ...c.evidence],
      });
  }
  const canon = (name: string) => personOf(name)?.name ?? name;
  const relationships = base.relationships.map((r) => ({ ...r, changes: [...r.changes], evidence: [...r.evidence] }));
  for (const r of next.relationships) {
    const from = canon(r.from);
    const to = canon(r.to);
    const existing = relationships.find((old) => same(canon(old.from), from) && same(canon(old.to), to));
    if (!existing) relationships.push({ ...r, from, to });
    else Object.assign(existing, { description: existing.description || r.description, changes: [...existing.changes, ...r.changes], evidence: [...existing.evidence, ...r.evidence] });
  }
  const speechRules: MergedRule[] = [...base.speechRules];
  for (const r of next.speechRules) {
    const rule = { ...r, from: canon(r.from), to: canon(r.to) };
    const samePlace = speechRules.filter((old) => same(canon(old.from), rule.from) && same(canon(old.to), rule.to) && old.start === rule.start);
    if (!samePlace.length) speechRules.push(rule);
    else if (!samePlace.some((old) => old.level === rule.level && same(old.address, rule.address))) speechRules.push({ ...rule, conflict: true });
  }
  const events = base.events.map((e) => ({ ...e, evidence: [...e.evidence] }));
  for (const e of next.events) {
    const existing = events.find((old) => same(old.title, e.title));
    if (!existing) events.push(e);
    else Object.assign(existing, { summary: existing.summary || e.summary, outcome: existing.outcome || e.outcome, participants: [...new Set([...existing.participants, ...e.participants])], evidence: [...existing.evidence, ...e.evidence] });
  }
  const terms = base.terms.map((t) => ({ ...t, evidence: [...t.evidence] }));
  for (const t of next.terms) {
    const existing = terms.find((old) => same(old.source, t.source));
    if (!existing) terms.push(t);
    else Object.assign(existing, { target: existing.target || t.target, meaning: existing.meaning || t.meaning, evidence: [...existing.evidence, ...t.evidence] });
  }
  const join = (a: string, b: string) => (a && b && !same(a, b) ? `${a}\n\n${b}` : a || b);
  return {
    overview: {
      setting: join(base.overview.setting, next.overview.setting),
      mainConflict: join(base.overview.mainConflict, next.overview.mainConflict),
      plot: join(base.overview.plot, next.overview.plot),
      evidence: [...base.overview.evidence, ...next.overview.evidence],
    },
    characters,
    relationships,
    events,
    speechRules,
    terms,
    sceneListeners: [...base.sceneListeners, ...next.sceneListeners],
  };
}

/** Speaker → listener pairs covering this share of dialogue lines are "main pairs": their rules wait for a person. */
export const MAIN_PAIR_SHARE = 0.8;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Stored = typeof s.documents | typeof s.characters | typeof s.relationships | typeof s.storyEvents | typeof s.speechRules | typeof s.terms;

/**
 * Stores an analysis. Items earlier analyses wrote that no person has touched are replaced; items a
 * person made, edited, confirmed or rejected stay, and a rejected item is not proposed again.
 * With auto-confirm, items are stored confirmed, except speech rules that need a person: rules of
 * the main pairs (the speaker → listener pairs that cover MAIN_PAIR_SHARE of dialogue lines),
 * rules that contradict another part of the analysis, and rules whose evidence lines are not the
 * rule's speaker's. Scene listeners fill lines whose listener nobody set. Evidence ids that are not
 * lines are dropped and counted.
 */
export function saveDrafts(db: Db, projectId: string, jobId: string, analysis: Analysis, keyOf: Map<string, string>, policy: AiConfirm = DEFAULT_AI_CONFIRM): Record<string, number> {
  let invalidEvidence = 0;
  const keys = (list: string[]) =>
    list.flatMap((id) => {
      const key = keyOf.get(id.trim());
      if (!key) invalidEvidence += 1;
      return key ? [key] : [];
    });
  const keyOrNull = (id: string | null) => (id ? (keyOf.get(id.trim()) ?? null) : null);
  // Each kind lands as AI › 사용 방식 says; AI set the status either way (docs/DESIGN.md 3.5).
  const draft = (kind: AiConfirmKind) => ({ status: aiStatus(policy, kind), statusBy: 'ai' as const, origin: 'ai' as const, jobId });
  const counts = { listeners: 0, rulesForReview: 0, terms: 0 };

  db.transaction((tx) => {
    // Only what earlier analyses wrote and nobody touched is replaced; workflow-made items and rejected ones stay.
    const analysisJobs = tx.select({ id: s.analysisJobs.id }).from(s.analysisJobs).where(eq(s.analysisJobs.projectId, projectId)).all().map((job) => job.id);
    const stale = (table: Stored) =>
      and(eq(table.projectId, projectId), eq(table.origin, 'ai'), eq(table.statusBy, 'ai'), ne(table.status, 'rejected'), analysisJobs.length ? inArray(table.jobId, analysisJobs) : sql`0`);
    tx.delete(s.relationships).where(stale(s.relationships)).run();
    // A draft character that a kept relationship points to stays (deleting it would take the relationship with it).
    const kept = tx.select({ fromId: s.relationships.fromId, toId: s.relationships.toId }).from(s.relationships).where(eq(s.relationships.projectId, projectId)).all().flatMap((r) => [r.fromId, r.toId]);
    tx.delete(s.characters).where(and(stale(s.characters), kept.length ? notInArray(s.characters.id, kept) : undefined)).run();
    tx.delete(s.documents).where(stale(s.documents)).run();
    tx.delete(s.storyEvents).where(stale(s.storyEvents)).run();
    tx.delete(s.speechRules).where(stale(s.speechRules)).run();
    tx.delete(s.terms).where(stale(s.terms)).run();

    const { overview } = analysis;
    const body = [overview.setting && `## 배경\n${overview.setting}`, overview.mainConflict && `## 주요 갈등\n${overview.mainConflict}`, overview.plot && `## 줄거리\n${overview.plot}`].filter(Boolean).join('\n\n');
    const title = '작품 개요 (AI 분석)';
    const documentRejected = tx.select({ id: s.documents.id }).from(s.documents).where(and(eq(s.documents.projectId, projectId), eq(s.documents.title, title), eq(s.documents.status, 'rejected'), eq(s.documents.body, body))).get();
    if (body && !documentRejected) tx.insert(s.documents).values({ projectId, kind: 'story', title, body, evidence: keys(overview.evidence), ...draft('documents') }).run();

    // People: a stored person (any status) keeps their name; rejected ones are not proposed again but nothing new points at them.
    const stored = tx.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases, status: s.characters.status, profile: s.characters.profile, speech: s.characters.speech, evidence: s.characters.evidence }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
    const live = stored.filter((c) => c.status !== 'rejected');
    // The model may still spell a known person differently ("Mara Holt" for the speaker "Mara"):
    // such names are mapped onto the stored person everywhere, so rules and relationships meet the lines' speakers.
    const canonical = canonicalNames(live, analysis.characters);
    const canon = (name: string) => canonical.get(name.trim().toLowerCase()) ?? name;
    const idByName = new Map<string, string>();
    for (const c of live) for (const name of namesOf(c)) idByName.set(name.toLowerCase(), c.id);
    const knownNames = new Set(stored.flatMap((c) => namesOf(c).map((name) => name.toLowerCase())));
    for (const c of analysis.characters) {
      if (namesOf(c).some((name) => knownNames.has(name.toLowerCase())) || canon(c.name) !== c.name) {
        // A person already in the cast (often only a name from the import) gets what the analysis
        // found in the fields still empty; nothing a person or the import wrote is replaced.
        const known = live.find((person) => person.id === idByName.get(canon(c.name).toLowerCase()));
        const fill = known && {
          ...(!known.profile.trim() && c.profile.trim() && { profile: c.profile }),
          ...(!known.speech.trim() && c.speech.trim() && { speech: c.speech }),
          ...(!known.evidence.length && keys(c.evidence).length && { evidence: keys(c.evidence) }),
        };
        if (fill && Object.keys(fill).length) tx.update(s.characters).set(fill).where(eq(s.characters.id, known.id)).run();
        continue;
      }
      const row = tx.insert(s.characters).values({ projectId, name: c.name, aliases: c.aliases, profile: c.profile, speech: c.speech, player: c.player, evidence: keys(c.evidence), ...draft('characters') }).returning({ id: s.characters.id }).get();
      for (const name of namesOf(c)) if (!idByName.has(name.toLowerCase())) idByName.set(name.toLowerCase(), row.id);
    }

    const pairsTaken = new Set(tx.select({ fromId: s.relationships.fromId, toId: s.relationships.toId, kind: s.relationships.kind }).from(s.relationships).where(eq(s.relationships.projectId, projectId)).all().map((r) => `${r.fromId}|${r.toId}`));
    for (const r of analysis.relationships) {
      const fromId = idByName.get(canon(r.from).toLowerCase());
      const toId = idByName.get(canon(r.to).toLowerCase());
      if (!fromId || !toId || pairsTaken.has(`${fromId}|${toId}`)) continue;
      pairsTaken.add(`${fromId}|${toId}`);
      const changes = r.changes.flatMap((change) => {
        const at = keyOrNull(change.at);
        return at ? [{ at, change: change.change, cause: change.cause }] : [];
      });
      tx.insert(s.relationships).values({ projectId, fromId, toId, kind: r.kind, description: r.description, changes, evidence: keys(r.evidence), ...draft('relationships') }).run();
    }

    const eventTitles = new Set(tx.select({ title: s.storyEvents.title }).from(s.storyEvents).where(eq(s.storyEvents.projectId, projectId)).all().map((e) => e.title.toLowerCase()));
    for (const e of analysis.events) {
      if (eventTitles.has(e.title.toLowerCase())) continue;
      eventTitles.add(e.title.toLowerCase());
      tx.insert(s.storyEvents).values({ projectId, title: e.title, summary: e.summary, cause: e.cause, outcome: e.outcome, participants: e.participants.map(canon), evidence: keys(e.evidence), ...draft('events') }).run();
    }

    // Terms follow the auto-confirm switch like the rest, except one without a Korean form: it stays a
    // candidate (an empty target would reach every prompt). A term already in the glossary keeps what it
    // has; the analysis only fills its empty form and note.
    const glossary = new Map(tx.select({ id: s.terms.id, source: s.terms.source, target: s.terms.target, note: s.terms.note, status: s.terms.status, examples: s.terms.examples }).from(s.terms).where(eq(s.terms.projectId, projectId)).all().map((t) => [t.source.toLowerCase(), t]));
    for (const t of analysis.terms) {
      const note = [TERM_KIND_LABELS[t.kind], t.meaning].filter(Boolean).join(' · ');
      const examples = keys(t.evidence).slice(0, 3);
      const known = glossary.get(t.source.trim().toLowerCase());
      if (known) {
        if (known.status === 'rejected') continue;
        const fill = { ...(!known.target.trim() && t.target.trim() && { target: t.target.trim() }), ...(!known.note.trim() && note && { note }), ...(!known.examples.length && examples.length && { examples }) };
        if (Object.keys(fill).length) tx.update(s.terms).set(fill).where(eq(s.terms.id, known.id)).run();
        continue;
      }
      const row = tx.insert(s.terms).values({ projectId, source: t.source.trim(), target: t.target.trim(), note, status: t.target.trim() ? aiStatus(policy, 'terms') : 'candidate', statusBy: 'ai', origin: 'ai', jobId, examples }).returning({ id: s.terms.id, source: s.terms.source, target: s.terms.target, note: s.terms.note, status: s.terms.status, examples: s.terms.examples }).get();
      glossary.set(row.source.toLowerCase(), row);
      counts.terms += 1;
    }

    // Scene listeners first: the main pairs below are counted on the listeners lines end up with.
    counts.listeners = applySceneListeners(tx, projectId, analysis.sceneListeners, live, canon, keyOf);
    const main = mainPairs(tx, projectId, live);
    const person = personKey(live);

    const speakerOf = new Map(tx.select({ key: s.units.key, speaker: s.units.speaker }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.key, unit.speaker]));
    const existingRules = tx.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all();
    const ruleKey = (from: string, to: string, start: string | null, level: string, address: string) => `${person(from)}|${person(to)}|${start}|${level}|${address}`.toLowerCase();
    const taken = new Set(existingRules.map((r) => ruleKey(r.fromName, r.toName, r.startKey, r.level, r.address)));
    for (const r of analysis.speechRules as MergedRule[]) {
      const from = canon(r.from);
      const to = canon(r.to);
      const start = keyOrNull(r.start);
      const key = ruleKey(from, to, start, r.level, r.address);
      if (taken.has(key)) continue;
      taken.add(key);
      const evidence = keys(r.evidence);
      // Evidence lines should be the rule's speaker talking; mostly someone else's means the rule is doubtful.
      const foreign = evidence.filter((line) => person(speakerOf.get(line) ?? '') !== person(from)).length;
      // An official rule (imported, a person's) for the same pair and stretch that says otherwise.
      const official = existingRules.find((old) => old.statusBy === 'human' && old.status === 'confirmed' && person(old.fromName) === person(from) && person(old.toName) === person(to) && old.startKey === start);
      const reasons = [
        official && official.level !== r.level && `정식 규칙(${SPEECH_LEVEL_LABELS[official.level]})과 다름`,
        r.conflict && '다른 부분의 분석과 엇갈림',
        evidence.length && foreign * 2 > evidence.length && '근거 대사의 화자가 다름',
        main.has(`${person(from)}|${person(to)}`) && '대사가 많은 주요 쌍',
      ].filter(Boolean) as string[];
      // Every rule is used at once (people rarely review long lists); doubts only mark it for a look.
      // A person's rule that says otherwise wins, so the AI one stays a candidate beside it.
      if (reasons.length) counts.rulesForReview += 1;
      const yieldsToPerson = Boolean(official && official.level !== r.level);
      const rule = tx.insert(s.speechRules)
        .values({ projectId, fromName: from, toName: to, level: r.level, address: r.address, note: r.note, startKey: start, evidence, ...draft('speechRules'), ...(yieldsToPerson && { status: 'candidate' as const }) })
        .returning({ id: s.speechRules.id })
        .get();
      if (reasons.length) markForReview(tx, projectId, 'speechRules', rule.id, reasons);
    }
  });
  return {
    documents: analysis.overview.plot || analysis.overview.setting ? 1 : 0,
    characters: analysis.characters.length,
    relationships: analysis.relationships.length,
    events: analysis.events.length,
    speechRules: analysis.speechRules.length,
    listeners: counts.listeners,
    rulesForReview: counts.rulesForReview,
    terms: counts.terms,
    invalidEvidence,
  };
}

/** Lower-cased stored person name for any of their names or aliases (else the name itself). */
function personKey(people: { name: string; aliases: string[] }[]) {
  const map = new Map<string, string>();
  for (const p of people) for (const name of namesOf(p)) map.set(name.trim().toLowerCase(), p.name.trim().toLowerCase());
  return (name: string) => map.get(name.trim().toLowerCase()) ?? name.trim().toLowerCase();
}

/**
 * Fills, per scene, the listener of a speaker's lines from the analysis, for dialogue lines whose
 * listener nobody set (none, or an earlier scene guess). It is stored as a scene guess: below the bar it
 * says "mostly X here" (the speaker addresses several people) and the line still counts as unknown.
 * Imported, human and per-line AI listeners are never touched. Returns the number of lines changed.
 */
function applySceneListeners(tx: Tx, projectId: string, entries: Analysis['sceneListeners'], people: { name: string; aliases: string[] }[], canon: (name: string) => string, keyOf: Map<string, string>) {
  if (!entries.length) return 0;
  const person = personKey(people);
  const groupByKey = new Map(tx.select({ id: s.groups.id, key: s.groups.key }).from(s.groups).where(eq(s.groups.projectId, projectId)).all().map((group) => [group.key, group.id]));
  const wanted = new Map<string, { listener: string | null; confidence: number }>();
  for (const entry of entries) {
    const groupId = groupByKey.get(entry.scene.trim());
    if (!groupId) continue;
    const listener = entry.listener && !isSpecialListener(entry.listener) ? canon(entry.listener) : entry.listener;
    wanted.set(`${groupId}|${person(canon(entry.speaker))}`, { listener, confidence: Math.min(1, Math.max(0, entry.confidence)) });
  }
  const changed = new Set<string>();
  const lines = tx
    .select({ id: s.units.id, groupId: s.units.groupId, speaker: s.units.speaker, listener: s.units.listener, origin: s.units.listenerOrigin, confidence: s.units.listenerConfidence })
    .from(s.units)
    .where(and(eq(s.units.projectId, projectId), eq(s.units.kind, 'dialogue')))
    .all();
  for (const line of lines) {
    if (!line.speaker || line.origin === 'import' || line.origin === 'human' || line.origin === 'ai') continue;
    const found = wanted.get(`${line.groupId}|${person(line.speaker)}`);
    if (!found || found.listener === null) continue;
    tx.update(s.units).set({ listener: found.listener, listenerOrigin: 'scene', listenerConfidence: found.confidence }).where(eq(s.units.id, line.id)).run();
    changed.add(line.id);
  }
  // Exceptions name the listener of one line: a per-line AI guess, over the scene default (and an
  // older analysis's guess), never over an imported or a person's listener.
  for (const entry of entries) {
    for (const exception of entry.exceptions) {
      const key = keyOf.get(exception.line.trim());
      if (!key) continue;
      const line = tx.select({ id: s.units.id, origin: s.units.listenerOrigin, kind: s.units.kind }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get();
      if (!line || line.kind !== 'dialogue' || line.origin === 'import' || line.origin === 'human') continue;
      const listener = exception.listener && !isSpecialListener(exception.listener) ? canon(exception.listener) : exception.listener;
      tx.update(s.units).set({ listener, listenerOrigin: 'ai', listenerConfidence: Math.min(1, Math.max(0, exception.confidence)) }).where(eq(s.units.id, line.id)).run();
      changed.add(line.id);
    }
  }
  return changed.size;
}

/** The speaker → listener pairs (stored-person keys) that together cover MAIN_PAIR_SHARE of dialogue lines with a known listener. */
export function mainPairs(tx: Tx | Db, projectId: string, people: { name: string; aliases: string[] }[]) {
  const person = personKey(people);
  const lines = tx
    .select({ speaker: s.units.speaker, listener: s.units.listener, origin: s.units.listenerOrigin, confidence: s.units.listenerConfidence })
    .from(s.units)
    .where(and(eq(s.units.projectId, projectId), eq(s.units.kind, 'dialogue')))
    .all();
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

/**
 * Lower-cased spellings → a stored person's name, for an analysis's people who are stored people under
 * another spelling: a shared name or alias, or the stored single-word name as a whole word of theirs
 * ("Mara" in "Mara Holt"). A word that fits several stored people maps to none.
 */
export function canonicalNames(stored: { name: string; aliases: string[] }[], found: { name: string; aliases: string[] }[]) {
  const byName = new Map<string, string>();
  for (const person of stored) for (const name of [person.name, ...person.aliases]) byName.set(name.toLowerCase(), person.name);
  const map = new Map<string, string>(byName);
  for (const person of found) {
    const names = [person.name, ...person.aliases].map((name) => name.trim().toLowerCase());
    let match = names.map((name) => byName.get(name)).find(Boolean);
    if (!match) {
      const words = new Set(names.flatMap((name) => name.split(/[\s_.-]+/)));
      const hits = stored.filter((candidate) => [candidate.name, ...candidate.aliases].some((name) => !/\s/.test(name.trim()) && words.has(name.trim().toLowerCase())));
      if (hits.length === 1) match = hits[0].name;
    }
    if (match) for (const name of names) map.set(name, match);
  }
  return map;
}
