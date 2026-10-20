import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as ai from '@tw/ai';
import { CALL_TIMEOUT_MS, formatPatternError } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { badRequest } from '../http-errors.ts';
import { logged } from './ai-calls.ts';
import { defaultModelChoice, liveChoice } from './routes.ts';
import type { SecretStore } from './secrets.ts';

export const REGEX_TARGETS = ['token', 'check'] as const;
export type RegexTarget = (typeof REGEX_TARGETS)[number];

const KINDS = { token: ['placeholder', 'tag'], check: ['forbidden', 'preserve', 'targetRequired'] } as const;

const TASK = {
  token: '사용자의 설명에 맞는 게임 대본 치환자(placeholder) 또는 서식 태그(tag)용 JavaScript 정규식 패턴을 작성하세요.',
  check:
    '사용자의 설명에 맞는 번역 형식 검사(forbidden: 번역문 금지 패턴, preserve: 원문과 번역문에서 동일하게 보존할 패턴, targetRequired: 번역문에 반드시 있어야 할 패턴)용 JavaScript 정규식 패턴을 작성하세요.',
} as const;

/**
 * 자연어로 정규식 만들기: one rule (label, kind, pattern, example) for the format-check settings,
 * made by the project's default model from the user's description and up to 10 source lines.
 * The pattern is checked with the same rule the settings use, so what comes back can be saved as is.
 */
export async function generateRegex(db: Db, secrets: SecretStore, projectId: string, request: { prompt: string; target: RegexTarget }, signal?: AbortSignal, generate: typeof ai.generate = ai.generate) {
  const choice = defaultModelChoice(db);
  if (!choice.connectionId) badRequest('AI 연결에 기본 모델이 없습니다. AI 설정에서 연결과 기본 모델을 고르세요.');
  const { snapshot, routes } = liveChoice(db, choice, secrets, 'generate');
  const samples = db.select({ source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.seq)).limit(10).all();
  const kinds = KINDS[request.target];
  const schema = z.object({
    label: z.string().describe('규칙의 짧은 한국어 이름 (예: 중괄호 변수, 영문 대문자 약어 금지)'),
    kind: z.enum(kinds).describe(request.target === 'token' ? 'placeholder(치환자) 또는 tag(서식 태그)' : 'forbidden(번역문 금지), preserve(원문→번역 보존), targetRequired(번역문 필수)'),
    pattern: z.string().describe('슬래시(/) 없이 작성한 유효한 JavaScript RegExp 패턴 문자열. 빈 문자열과 일치하면 안 됩니다.'),
    example: z.string().describe('패턴에 매칭되는 예시 문자열 1~2개'),
  });
  const prompt = [TASK[request.target], `사용자 요청: ${request.prompt}`, samples.length ? `대본 샘플:\n${samples.map((row) => `- ${row.source}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  const system = '당신은 JavaScript 정규식 전문가입니다. 요청한 필드만 채워 돌려주세요.';
  const call = { projectId, kind: 'editor' as const, label: '자연어로 정규식 만들기', request: `${system}\n\n---\n\n${prompt}` };
  const result = await ai.withFallback(
    routes,
    snapshot.maxAttempts,
    (route) => logged(db, call, route, () => generate(route, { system, prompt, schema, maxOutputTokens: snapshot.maxOutputTokens, timeoutMs: CALL_TIMEOUT_MS.regex, signal })),
    signal,
  );
  const rule = schema.parse(result.result.object);
  const error = formatPatternError(rule.pattern);
  if (error) badRequest(`생성된 정규식을 쓸 수 없습니다. 설명을 바꿔 다시 해 보세요. (${error})`);
  return rule;
}
