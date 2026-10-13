import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { compileFormatRules, editorAiSchema, mentions, SPEECH_LEVEL_LABELS, listenerLabel } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { logged } from './ai-calls.ts';
import { liveChoice } from './routes.ts';
import type { SecretStore } from './secrets.ts';
import { speechRuleIndex } from './speech.ts';

export const COMPLETE_SYSTEM =
  'You continue a Korean game translation in a translator\'s editor. Reply with the full Korean translation of LINE only, beginning exactly with TRANSLATION SO FAR when it is given. Copy the format tokens exactly. Follow the glossary and the speech level. No quotes, notes or explanations.';

/** A continuation later than this is no help while typing. */
const COMPLETE_TIMEOUT_MS = 15_000;

/** Why a continuation was not made, for the editor to show quietly. */
export class CompleteRefused extends Error {
  constructor(
    message: string,
    readonly status: 400 | 429,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** Calls made today (local midnight on) for the editor of a project, against its daily cap. */
export function editorCallsToday(db: Db, projectId: string) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return db.select({ n: sql<number>`count(*)` }).from(s.aiCalls).where(and(eq(s.aiCalls.projectId, projectId), eq(s.aiCalls.kind, 'editor'), gte(s.aiCalls.startedAt, midnight))).get()?.n ?? 0;
}

/**
 * The editor's continuation of one line (docs/DESIGN.md J3b A): the whole line's translation
 * from a small context (the line, who says it to whom and how, the three lines before, the
 * glossary terms it uses, its format tokens), starting with what the translator has typed.
 * One call per request; the editor asks once per line and follows typing itself.
 */
export async function completeLine(db: Db, secrets: SecretStore, unitId: string, prefix: string, signal?: AbortSignal) {
  const unit = db.select().from(s.units).where(eq(s.units.id, unitId)).get();
  if (!unit) throw new CompleteRefused('대사가 없습니다.', 400);
  const project = db.select({ editorAi: s.projects.editorAi, formatRules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, unit.projectId)).get()!;
  const settings = editorAiSchema.parse(project.editorAi ?? {});
  if (!settings.enabled || !settings.model) throw new CompleteRefused('편집기 자동완성이 꺼져 있습니다.', 400);
  if (editorCallsToday(db, unit.projectId) >= settings.dailyCap) {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    throw new CompleteRefused(`오늘 자동완성 한도(${settings.dailyCap}회)를 다 썼습니다.`, 429, Math.ceil((midnight.getTime() - Date.now()) / 1000));
  }
  const { routes } = liveChoice(db, settings.model, secrets, 'generate');
  // Thinking models answer late; unless an effort was chosen, a continuation asks for little thinking.
  const route: ai.ResolvedRoute = { ...routes[0]!, effort: routes[0]!.effort ?? 'low' };
  if (route.kind !== 'openai') throw new CompleteRefused('편집기 자동완성은 API 연결(OpenAI 호환)만 쓸 수 있습니다.', 400);

  const before = db
    .select({ speaker: s.units.speaker, source: s.units.source, translation: s.units.translation })
    .from(s.units)
    .where(and(eq(s.units.groupId, unit.groupId), lt(s.units.seq, unit.seq)))
    .orderBy(desc(s.units.seq))
    .limit(3)
    .all()
    .reverse();
  const rule = speechRuleIndex(db, unit.projectId).resolve([unit]).get(unit.key);
  const compiled = compileFormatRules(project.formatRules ?? undefined);
  const tokens = [compiled.placeholder, compiled.tag].flatMap((pattern) => (pattern ? (unit.source.match(pattern) ?? []) : []));
  const plain = [compiled.placeholder, compiled.tag].reduce((text, pattern) => (pattern ? text.replace(pattern, ' ') : text), unit.source);
  const terms = db
    .select({ source: s.terms.source, target: s.terms.target })
    .from(s.terms)
    .where(and(eq(s.terms.projectId, unit.projectId), eq(s.terms.status, 'confirmed')))
    .all()
    .filter((term) => term.target && mentions(plain, term.source));

  const who = [unit.speaker ?? '(narration)', unit.listener && `→ ${listenerLabel(unit.listener)}`, rule && `(speech level: ${SPEECH_LEVEL_LABELS[rule.rule.level]}${rule.rule.address ? `, addresses them as "${rule.rule.address}"` : ''})`].filter(Boolean).join(' ');
  const prompt = [
    'LINE',
    `speaker: ${who}`,
    `source: ${unit.source}`,
    ...(before.length ? ['', 'PREVIOUS LINES', ...before.map((line) => `- ${line.speaker ?? '(narration)'}: ${line.source}${line.translation ? ` / 번역: ${line.translation}` : ''}`)] : []),
    ...(terms.length ? ['', 'GLOSSARY', ...terms.map((term) => `- ${term.source} → ${term.target}`)] : []),
    ...(tokens.length ? ['', `FORMAT TOKENS (copy exactly): ${tokens.join(' ')}`] : []),
    '',
    `TRANSLATION SO FAR: ${prefix ? `"${prefix}"` : '(empty)'}`,
  ].join('\n');

  const call = (target: ai.ResolvedRoute) =>
    logged(db, { projectId: unit.projectId, kind: 'editor', refId: unitId, label: '편집기 자동완성', request: prompt }, target, () =>
      ai.complete(target, { system: COMPLETE_SYSTEM, prompt, maxOutputTokens: 400, timeoutMs: COMPLETE_TIMEOUT_MS, signal }),
    );
  const result = await call(route)
    // A model that takes no reasoning effort may refuse the field we added: once more without it.
    .catch((error: unknown) => {
      if (!routes[0]!.effort && error instanceof ai.ModelError && error.code === 'config') return call({ ...route, effort: undefined });
      throw error;
    })
    .catch((error: unknown) => {
    if (error instanceof ai.ModelError && error.code === 'rate-limit') throw new CompleteRefused('모델 요청 한도에 걸렸습니다. 잠시 뒤 다시.', 429, 60);
    if (error instanceof ai.ModelError && error.code === 'timeout') throw new CompleteRefused(`응답이 ${COMPLETE_TIMEOUT_MS / 1000}초 안에 오지 않아 그만뒀습니다. 더 빠른 모델을 고르세요.`, 400);
    throw error;
  });
  // The line as a whole; models sometimes wrap it in quotes or add the prefix twice.
  const text = result.text.trim().replace(/^["“'](.*)["”']$/s, '$1');
  return { text, callsToday: editorCallsToday(db, unit.projectId), dailyCap: settings.dailyCap };
}
