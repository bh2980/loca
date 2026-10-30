import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { compileFormatRules, editorAiSchema, glossaryMatcher, SPEECH_LEVEL_LABELS, listenerLabel } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { logged } from './ai-calls.ts';
import { liveChoice } from './routes.ts';
import type { SecretStore } from './secrets.ts';
import { speechRuleIndex } from './speech.ts';


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

/** Autocomplete calls made today (local midnight on) in a project, against its daily cap: they go out as the person types, AI 번역·다듬기 only on a click. */
const COMPLETE_LABEL = '편집기 자동완성';
export function editorCallsToday(db: Db, projectId: string) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return db.select({ n: sql<number>`count(*)` }).from(s.aiCalls).where(and(eq(s.aiCalls.projectId, projectId), eq(s.aiCalls.kind, 'editor'), eq(s.aiCalls.label, COMPLETE_LABEL), gte(s.aiCalls.startedAt, midnight))).get()?.n ?? 0;
}

/**
 * The editor's continuation of one line: the whole line's translation from a small context set in
 * 설정 › 에디터 (the line and its format tokens always; who says it to whom and how, the lines before
 * it, the glossary terms it uses when turned on), starting with what the translator has typed.
 * One call per request; the editor asks once per line and follows typing itself.
 */
export async function completeLine(db: Db, secrets: SecretStore, unitId: string, prefix: string, signal?: AbortSignal) {
  const unit = db.select().from(s.units).where(eq(s.units.id, unitId)).get();
  if (!unit) throw new CompleteRefused('대사가 없습니다.', 400);
  const project = db.select({ editorAi: s.projects.editorAi, formatRules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, unit.projectId)).get()!;
  const settings = editorAiSchema.parse(project.editorAi ?? {}).complete;
  if (!settings.enabled || !settings.model) throw new CompleteRefused('편집기 자동완성이 꺼져 있습니다.', 400);
  if (editorCallsToday(db, unit.projectId) >= settings.dailyCap) {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    throw new CompleteRefused(`오늘 자동완성 한도(${settings.dailyCap}회)를 다 썼습니다.`, 429, Math.ceil((midnight.getTime() - Date.now()) / 1000));
  }
  const { route: chosen } = liveChoice(db, settings.model, secrets, 'generate');
  // The effort is the person's choice: "모델 기본값" sends none (a slow thinking model: pick low).
  const route: ai.ResolvedRoute = chosen;
  if (route.kind !== 'openai') throw new CompleteRefused('편집기 자동완성은 API 연결(OpenAI 호환)만 쓸 수 있습니다.', 400);

  const before = db
    .select({ speaker: s.units.speaker, source: s.units.source, translation: s.units.translation })
    .from(s.units)
    .where(and(eq(s.units.groupId, unit.groupId), lt(s.units.seq, unit.seq)))
    .orderBy(desc(s.units.seq))
    .limit(settings.precedingLines)
    .all()
    .reverse();
  const rule = settings.speech ? speechRuleIndex(db, unit.projectId).resolve([unit]).get(unit.key) : undefined;
  const compiled = compileFormatRules(project.formatRules ?? undefined);
  const tokens = [compiled.placeholder, compiled.tag].flatMap((pattern) => (pattern ? (unit.source.match(pattern) ?? []) : []));
  const plain = [compiled.placeholder, compiled.tag].reduce((text, pattern) => (pattern ? text.replace(pattern, ' ') : text), unit.source);
  const terms = settings.glossary
    ? glossaryMatcher(db.select({ source: s.terms.source, target: s.terms.target, scope: s.terms.scope, matchCase: s.terms.matchCase }).from(s.terms).where(and(eq(s.terms.projectId, unit.projectId), eq(s.terms.status, 'confirmed'))).all().filter((term) => term.target))
        .find(plain, unit.kind)
        .map(({ source, target }) => ({ source, target }))
    : [];

  const who = [unit.speaker ?? '(narration)', settings.speech && unit.listener && `→ ${listenerLabel(unit.listener)}`, rule && `(speech level: ${SPEECH_LEVEL_LABELS[rule.rule.level]}${rule.rule.address ? `, addresses them as "${rule.rule.address}"` : ''})`].filter(Boolean).join(' ');
  const prompt = [
    'LINE',
    `speaker: ${who}`,
    `source: ${unit.source}`,
    ...(before.length ? ['', 'PREVIOUS LINES', ...before.map((line) => `- ${line.speaker ?? '(narration)'}: ${line.source}${line.translation ? ` / 번역: ${line.translation}` : ''}`)] : []),
    ...(terms.length ? ['', 'GLOSSARY', ...terms.map((term) => `- ${term.source} → ${term.target}`)] : []),
    ...(tokens.length ? ['', `FORMAT TOKENS (copy exactly): ${tokens.join(' ')}`] : []),
    '',
    prefix ? `Started by the translator:\n<started>${prefix}</started>` : 'The translator has not started this line.',
  ].join('\n');

  const call = (target: ai.ResolvedRoute) =>
    logged(db, { projectId: unit.projectId, kind: 'editor', refId: unitId, label: COMPLETE_LABEL, request: prompt }, target, () =>
      ai.complete(target, { system: settings.instructions, prompt, maxOutputTokens: 400, timeoutMs: settings.timeoutSeconds * 1000, signal }),
    );
  const result = await call(route).catch((error: unknown) => {
    if (error instanceof ai.ModelError && error.code === 'rate-limit') throw new CompleteRefused('모델 요청 한도에 걸렸습니다. 잠시 뒤 다시.', 429, 60);
    if (error instanceof ai.ModelError && error.code === 'timeout') throw new CompleteRefused(`응답이 ${settings.timeoutSeconds}초 안에 오지 않아 그만뒀습니다. 더 빠른 모델을 고르거나 설정 › 에디터에서 제한 시간을 늘리세요.`, 400);
    throw error;
  });
  // The line as a whole; models sometimes wrap it in quotes or add the prefix twice.
  const text = cleanReply(result.text, unit.source);
  return { text, callsToday: editorCallsToday(db, unit.projectId), dailyCap: settings.dailyCap };
}

/**
 * The line from a model's reply: small models echo the prompt's labels ("TRANSLATION SO FAR: …",
 * "<started>…"), wrap the line in quotes or add lines of their own. A one-line source keeps the
 * first line only.
 */
export function cleanReply(reply: string, source: string) {
  let text = reply.trim().replace(/<\/?started>/g, '');
  text = text.replace(/^(?:translation so far|started by the translator|translation|korean|번역(?:문)?|한국어)\s*[:：]\s*/i, '');
  if (!source.includes('\n')) text = text.split('\n').find((line) => line.trim()) ?? '';
  return text.trim().replace(/^["“'](.*)["”']$/s, '$1').trim();
}
