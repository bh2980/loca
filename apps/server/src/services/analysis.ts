import { and, desc, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { SPEECH_LEVEL_GUIDE, SPEECH_LEVELS } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import type { ModelPort } from '../engine/runner.ts';
import { resolveRoutes, snapshotProfiles } from './routes.ts';
import { packBlocks, scriptText } from './script-text.ts';
import type { SecretStore } from './secrets.ts';

/**
 * Parts above this many estimated tokens are split at scene boundaries. Long-context models read
 * a whole game in one call (a 2,700-line game ≈ 80k), which the experiments found as accurate as reading in
 * parts and five times cheaper; splitting is only for scripts larger than the model's window.
 */
export const ANALYSIS_PART_TOKENS = 300_000;
/** A whole-script read takes minutes; the profile's per-call timeout is for single scenes. */
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
});
export type Analysis = z.infer<typeof analysisSchema>;

const SYSTEM = `You are reading the complete script of a game so that translators into Korean get the background they need.
Script format: "## <section> — <scene> [<scene key>]" headers; lines "L<n> <Speaker>: <text>"; "[문서]" and "[UI]" are in-game documents and interface text; "▶ <label>" before a line means it follows that player choice or condition. Lines after different choices are alternatives, never one conversation.

Rules:
- Use only what the text says. Do NOT use prior knowledge of this game.
- Every item cites evidence as line ids like ["L120","L131"].
- Write in Korean, except names and quoted source words.
- characters: everyone who speaks or is addressed often. "speech" describes how they talk in the source. Mark the player character (the one the player controls or who is addressed as "you" by the game, even if it never speaks) with "player": true.
- relationships: one per direction that matters; "changes" give the line id ("at") where the relationship changes and why.
- events: what happened, its cause and its outcome, the people involved; include events that later lines refer back to.
- speechRules: for every speaker → listener direction with several lines, the Korean speech level the translation should use, one of: ${SPEECH_LEVEL_GUIDE}. Decide from the relationship (age, rank, intimacy, hostility, era and setting) as a Korean translator would; narration-like or written addresses often take 해라체, close friends 해체. "address" is how the speaker should address the listener in Korean (e.g. "수사관님", "언니"), empty if none. If the level changes at some point (falling out, reconciliation, promotion), give one rule per stretch: "start" is the line id where the new stretch begins (null for the first). Do not mark a single sarcastic or emotional line as a change. "note" says why.
- Keep the whole answer under about 15,000 words.`;

const RETURN = 'Return only JSON with "overview", "characters", "relationships", "events" and "speechRules".';

type Job = typeof s.analysisJobs.$inferSelect;

/**
 * Work analysis (작품 분석): a long-context model reads the whole script and drafts the overview,
 * characters, relationships, events and speech rules. Drafts are stored as AI candidates; they
 * reach translation context only after a person confirms them. Re-running replaces the previous
 * unconfirmed AI drafts and never touches confirmed or human-made knowledge.
 */
export class AnalysisService {
  private aborts = new Map<string, AbortController>();

  constructor(
    private db: Db,
    private secrets: SecretStore,
    private model: Pick<ModelPort, 'generate'> = { generate: ai.generate },
  ) {
    // A restart cuts off any job in flight.
    db.update(s.analysisJobs).set({ status: 'failed', error: '서버가 다시 시작되어 중단되었습니다.', finishedAt: new Date() }).where(eq(s.analysisJobs.status, 'running')).run();
  }

  list(projectId: string): Job[] {
    return this.db.select().from(s.analysisJobs).where(eq(s.analysisJobs.projectId, projectId)).orderBy(desc(s.analysisJobs.createdAt)).limit(10).all();
  }

  start(projectId: string, profileId: string): Job {
    if (this.db.select().from(s.analysisJobs).where(and(eq(s.analysisJobs.projectId, projectId), eq(s.analysisJobs.status, 'running'))).get()) throw new Error('이미 진행 중인 작품 분석이 있습니다.');
    const profile = snapshotProfiles(this.db, [profileId])[profileId];
    if (!profile) throw new Error('모델 프로필을 찾을 수 없습니다.');
    if (profile.routes[0]?.kind === 'systemone') throw new Error('System One 프로필은 판정 전용이라 작품 분석에 쓸 수 없습니다.');
    const { blocks, keyOf } = scriptText(this.db, projectId);
    if (!blocks.length) throw new Error('분석할 대본이 없습니다.');
    const parts = packBlocks(blocks, ANALYSIS_PART_TOKENS);
    const job = this.db.insert(s.analysisJobs).values({ projectId, profileId, model: profile.routes[0]?.model ?? null, status: 'running', partsTotal: parts.length }).returning().get();
    const abort = new AbortController();
    this.aborts.set(job.id, abort);
    events.changed(projectId, 'analysis');
    void this.run(job, profile, parts, keyOf, abort.signal).finally(() => this.aborts.delete(job.id));
    return job;
  }

  cancel(jobId: string) {
    this.aborts.get(jobId)?.abort();
    const job = this.db.update(s.analysisJobs).set({ status: 'cancelled', finishedAt: new Date() }).where(and(eq(s.analysisJobs.id, jobId), eq(s.analysisJobs.status, 'running'))).returning().get();
    if (job) events.changed(job.projectId, 'analysis');
  }

  private async run(job: Job, profile: s.ProfileSnapshot, parts: string[], keyOf: Map<string, string>, signal: AbortSignal) {
    const routes = resolveRoutes(profile, this.secrets);
    let merged = null as Analysis | null;
    const usage = { inputTokens: 0, outputTokens: 0 };
    try {
      for (const [index, part] of parts.entries()) {
        const known: string = merged ? `\n\nALREADY KNOWN from earlier parts (reuse these names; return only what this part adds or changes):\n${summarize(merged)}` : '';
        const where = parts.length > 1 ? `\nThis is part ${index + 1} of ${parts.length} of the script, in order.` : '';
        const result = await ai.withFallback(
          routes,
          profile.maxAttempts,
          (route) =>
            this.model.generate<Analysis>(route, {
              system: [SYSTEM, profile.instructions].filter(Boolean).join('\n\n'),
              prompt: `${RETURN}${where}${known}\n\nSCRIPT:\n${part}`,
              schema: analysisSchema,
              maxOutputTokens: profile.maxOutputTokens,
              temperature: profile.temperature ?? undefined,
              timeoutMs: Math.max(profile.timeoutSeconds * 1000, MIN_TIMEOUT_MS),
              signal,
            }),
          signal,
        );
        usage.inputTokens += result.result.usage.inputTokens ?? 0;
        usage.outputTokens += result.result.usage.outputTokens ?? 0;
        merged = merged ? mergeAnalysis(merged, result.result.object) : result.result.object;
        if (signal.aborted) return;
        this.db.update(s.analysisJobs).set({ partsDone: index + 1, usage }).where(eq(s.analysisJobs.id, job.id)).run();
        events.changed(job.projectId, 'analysis');
      }
      if (signal.aborted || !merged) return;
      const counts = saveDrafts(this.db, job.projectId, job.id, merged, keyOf);
      this.db.update(s.analysisJobs).set({ status: 'completed', result: counts, usage, finishedAt: new Date() }).where(eq(s.analysisJobs.id, job.id)).run();
      events.changed(job.projectId, 'analysis', 'knowledge');
    } catch (error) {
      if (signal.aborted) return;
      this.db.update(s.analysisJobs).set({ status: 'failed', error: error instanceof Error ? error.message : String(error), usage, finishedAt: new Date() }).where(eq(s.analysisJobs.id, job.id)).run();
      events.changed(job.projectId, 'analysis');
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

/** Adds a later part's findings: same-named characters, relationships and rules are extended, not duplicated. */
export function mergeAnalysis(base: Analysis, next: Analysis): Analysis {
  const characters = [...base.characters];
  for (const c of next.characters) {
    const existing = characters.find((old) => [old.name, ...old.aliases].some((name) => same(name, c.name)));
    if (!existing) characters.push(c);
    else Object.assign(existing, { aliases: [...new Set([...existing.aliases, ...c.aliases])], profile: existing.profile || c.profile, speech: existing.speech || c.speech, player: existing.player || c.player, evidence: [...existing.evidence, ...c.evidence] });
  }
  const relationships = [...base.relationships];
  for (const r of next.relationships) {
    const existing = relationships.find((old) => same(old.from, r.from) && same(old.to, r.to));
    if (!existing) relationships.push(r);
    else Object.assign(existing, { changes: [...existing.changes, ...r.changes], evidence: [...existing.evidence, ...r.evidence] });
  }
  const speechRules = [...base.speechRules];
  for (const r of next.speechRules) if (!speechRules.some((old) => same(old.from, r.from) && same(old.to, r.to) && old.start === r.start)) speechRules.push(r);
  return {
    overview: { ...base.overview, plot: [base.overview.plot, next.overview.plot].filter(Boolean).join('\n\n'), evidence: [...base.overview.evidence, ...next.overview.evidence] },
    characters,
    relationships,
    events: [...base.events, ...next.events],
    speechRules,
  };
}

/** Replaces the previous unconfirmed AI drafts with this analysis. Evidence ids that are not lines are dropped and counted. */
export function saveDrafts(db: Db, projectId: string, jobId: string, analysis: Analysis, keyOf: Map<string, string>): Record<string, number> {
  let invalidEvidence = 0;
  const keys = (list: string[]) =>
    list.flatMap((id) => {
      const key = keyOf.get(id.trim());
      if (!key) invalidEvidence += 1;
      return key ? [key] : [];
    });
  const keyOrNull = (id: string | null) => (id ? (keyOf.get(id.trim()) ?? null) : null);
  const draft = { status: 'candidate' as const, origin: 'ai' as const, jobId };

  db.transaction((tx) => {
    const stale = (table: typeof s.documents | typeof s.characters | typeof s.relationships | typeof s.storyEvents | typeof s.speechRules) =>
      and(eq(table.projectId, projectId), eq(table.status, 'candidate'), eq(table.origin, 'ai'));
    tx.delete(s.relationships).where(stale(s.relationships)).run();
    // A draft character that a kept relationship points to stays (deleting it would take the relationship with it).
    const kept = tx.select({ fromId: s.relationships.fromId, toId: s.relationships.toId }).from(s.relationships).where(eq(s.relationships.projectId, projectId)).all().flatMap((r) => [r.fromId, r.toId]);
    tx.delete(s.characters).where(and(stale(s.characters), kept.length ? notInArray(s.characters.id, kept) : undefined)).run();
    tx.delete(s.documents).where(stale(s.documents)).run();
    tx.delete(s.storyEvents).where(stale(s.storyEvents)).run();
    tx.delete(s.speechRules).where(stale(s.speechRules)).run();

    const { overview } = analysis;
    const body = [overview.setting && `## 배경\n${overview.setting}`, overview.mainConflict && `## 주요 갈등\n${overview.mainConflict}`, overview.plot && `## 줄거리\n${overview.plot}`].filter(Boolean).join('\n\n');
    if (body) tx.insert(s.documents).values({ projectId, kind: 'story', title: '작품 개요 (AI 분석)', body, evidence: keys(overview.evidence), ...draft }).run();

    // Relationships point at characters: a confirmed character with that name wins, else the new draft.
    const existing = tx.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
    const idByName = new Map<string, string>();
    for (const c of existing) for (const name of [c.name, ...c.aliases]) idByName.set(name.toLowerCase(), c.id);
    // Kept knowledge (confirmed or made by a person) is not proposed again; changes to it show as new drafts only when they differ.
    const keptNames = new Set(existing.flatMap((c) => [c.name, ...c.aliases].map((name) => name.toLowerCase())));
    for (const c of analysis.characters) {
      if ([c.name, ...c.aliases].some((name) => keptNames.has(name.toLowerCase()))) continue;
      const row = tx.insert(s.characters).values({ projectId, name: c.name, aliases: c.aliases, profile: c.profile, speech: c.speech, player: c.player, evidence: keys(c.evidence), ...draft }).returning({ id: s.characters.id }).get();
      for (const name of [c.name, ...c.aliases]) if (!idByName.has(name.toLowerCase())) idByName.set(name.toLowerCase(), row.id);
    }
    const keptPairs = new Set(tx.select({ fromId: s.relationships.fromId, toId: s.relationships.toId }).from(s.relationships).where(eq(s.relationships.projectId, projectId)).all().map((r) => `${r.fromId}|${r.toId}`));
    for (const r of analysis.relationships) {
      const fromId = idByName.get(r.from.toLowerCase());
      const toId = idByName.get(r.to.toLowerCase());
      if (!fromId || !toId || keptPairs.has(`${fromId}|${toId}`)) continue;
      const changes = r.changes.flatMap((change) => {
        const at = keyOrNull(change.at);
        return at ? [{ at, change: change.change, cause: change.cause }] : [];
      });
      tx.insert(s.relationships).values({ projectId, fromId, toId, kind: r.kind, description: r.description, changes, evidence: keys(r.evidence), ...draft }).run();
    }
    for (const e of analysis.events) tx.insert(s.storyEvents).values({ projectId, title: e.title, summary: e.summary, cause: e.cause, outcome: e.outcome, participants: e.participants, evidence: keys(e.evidence), ...draft }).run();
    const keptRules = new Set(tx.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all().map((r) => `${r.fromName}|${r.toName}|${r.startKey}|${r.level}|${r.address}`.toLowerCase()));
    for (const r of analysis.speechRules)
      if (!keptRules.has(`${r.from}|${r.to}|${keyOrNull(r.start)}|${r.level}|${r.address}`.toLowerCase()))
        tx.insert(s.speechRules).values({ projectId, fromName: r.from, toName: r.to, level: r.level, address: r.address, note: r.note, startKey: keyOrNull(r.start), evidence: keys(r.evidence), ...draft }).run();
  });
  return {
    documents: analysis.overview.plot || analysis.overview.setting ? 1 : 0,
    characters: analysis.characters.length,
    relationships: analysis.relationships.length,
    events: analysis.events.length,
    speechRules: analysis.speechRules.length,
    invalidEvidence,
  };
}

