import pRetry from 'p-retry';
import type { LanguageModel } from 'ai';
import { CONNECTION_KIND_INFO } from '@tw/shared';
import { cliGenerate, cliModelList, cliModels, cliVersion, describeCli } from './cli.ts';
import { ModelError, toModelError } from './errors.ts';
import { openaiChatModel, openaiComplete, openaiGenerate, openaiModelList, openaiModels } from './openai.ts';
import { systemOneAsk, systemOneJudge, systemOneModels } from './systemone.ts';
import type { AskRequest, AskResult, CompleteRequest, CompleteResult, GenerateRequest, GenerateResult, JudgeRequest, JudgeResult, ModelLimitsInfo, ResolvedRoute, Usage } from './types.ts';

export * from './types.ts';
export { ModelError, type ModelErrorCode } from './errors.ts';
export { cliVersion, openLoginTerminal, LOGIN_COMMANDS } from './cli.ts';
export { ACP_KINDS, AcpAgent, acpError, agentFor, agentWith, checkCliLogin, closeSession, isAcpKind, setAgentStarter, stopIdleAgents, type AcpKind, type SessionListener } from './acp.ts';
export { hostTools, type HostedServer, type HostedTool } from './mcp-host.ts';
export { limitsOf, openaiProviderOptions } from './openai.ts';

export function generate<T>(route: ResolvedRoute, request: GenerateRequest<T>): Promise<GenerateResult<T>> {
  if (route.kind === 'openai') return openaiGenerate(route, request);
  if (route.kind === 'systemone') throw new ModelError('config', 'System One은 판정(검수)에만 사용할 수 있습니다.', false);
  if (route.kind === 'http') throw new ModelError('config', 'HTTP 도구 연결은 AI 노드에 쓸 수 없습니다.', false);
  return cliGenerate(route, request);
}

/** Plain text for the editor (API connections only: a CLI takes seconds per call). */
export function complete(route: ResolvedRoute, request: CompleteRequest): Promise<CompleteResult> {
  if (route.kind !== 'openai') throw new ModelError('config', '편집기 자동완성은 API 연결(OpenAI 호환)만 쓸 수 있습니다.', false);
  return openaiComplete(route, request);
}

export function judge(route: ResolvedRoute, request: JudgeRequest): Promise<JudgeResult> {
  if (route.kind !== 'systemone') throw new ModelError('config', '판정 전용 연결이 아닙니다.', false);
  return systemOneJudge(route, request);
}

/** Typed questions (yes/no, choice, score) for a judgment model; System One only. */
export function ask(route: ResolvedRoute, request: AskRequest): Promise<AskResult> {
  if (route.kind !== 'systemone') throw new ModelError('config', '판정 전용 연결이 아닙니다.', false);
  return systemOneAsk(route, request);
}

export function chatModel(route: ResolvedRoute): LanguageModel {
  if (!CONNECTION_KIND_INFO[route.kind].capabilities.includes('chat'))
    throw new ModelError('config', '이 연결은 채팅(도구 호출)을 지원하지 않습니다.', false);
  return openaiChatModel(route);
}

/** Model ids the connection can serve. CLIs do not expose a reliable list, so the user types the id. */
export async function listModels(route: Omit<ResolvedRoute, 'model'>): Promise<string[] | null> {
  if (route.kind === 'http') return null;
  if (route.kind === 'openai') return openaiModels(route);
  if (route.kind === 'systemone') return systemOneModels(route);
  if (route.kind === 'grok' || route.kind === 'antigravity' || route.kind === 'opencode' || route.kind === 'codex' || route.kind === 'claude') return cliModels(route.kind, route.executable);
  return null;
}

/**
 * The model list with what it says about each model's limits: an API's model list, or a CLI's own
 * list and cache files (codex, grok, opencode; claude and antigravity say nothing). One request or run.
 */
export async function listModelCatalog(route: Omit<ResolvedRoute, 'model'>): Promise<{ models: string[] | null; limits: Record<string, ModelLimitsInfo> }> {
  if (route.kind === 'openai') {
    const list = await openaiModelList(route);
    return { models: list.ids, limits: list.limits };
  }
  if (route.kind === 'codex' || route.kind === 'grok' || route.kind === 'antigravity' || route.kind === 'opencode' || route.kind === 'claude') {
    const list = await cliModelList(route.kind, route.executable);
    return { models: list?.models ?? null, limits: list?.limits ?? {} };
  }
  return { models: await listModels(route), limits: {} };
}

/** Cheap reachability check: API → model list, CLI → `--version`. */
export async function probe(route: Omit<ResolvedRoute, 'model'>): Promise<string> {
  if (route.kind === 'http') {
    const response = await fetch(route.baseUrl ?? '', { signal: AbortSignal.timeout(10_000) }).catch(() => {
      throw new ModelError('network', '주소에 연결하지 못했습니다.');
    });
    return `서버가 응답했습니다 (HTTP ${response.status}).`;
  }
  if (route.kind === 'openai' || route.kind === 'systemone') {
    const models = await listModels(route);
    return `모델 ${models?.length ?? 0}개를 확인했습니다.`;
  }
  const kind = route.kind as Parameters<typeof cliVersion>[0];
  const version = await cliVersion(kind, route.executable);
  const { resolved } = describeCli(kind, route.executable);
  return resolved ? `CLI ${version} · ${resolved}` : `CLI ${version}`;
}

/**
 * Where a CLI connection's executable is: the command it runs (the field, or the kind's default), the
 * file that resolves to on PATH and the usual install dirs (null when none), and its --version line.
 */
export async function locateCli(kind: Parameters<typeof cliVersion>[0], executable?: string): Promise<{ command: string; resolved: string | null; version: string | null }> {
  const { command, resolved } = describeCli(kind, executable);
  const version = resolved ? await cliVersion(kind, executable).catch(() => null) : null;
  return { command, resolved, version };
}

export interface Attempt {
  route: number;
  model: string;
  ok: boolean;
  error?: string;
  code?: string;
  /** What this attempt used, when the connection reported it (also for failed attempts). */
  usage?: Usage;
}

/**
 * Try the primary route, then each fallback in order. A route is retried with backoff only on
 * transient failures (rate limit, network, timeout); anything else stops immediately.
 */
export async function withFallback<R>(
  routes: ResolvedRoute[],
  maxAttempts: number,
  call: (route: ResolvedRoute) => Promise<R>,
  signal?: AbortSignal,
): Promise<{ result: R; route: ResolvedRoute; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  let last: ModelError | undefined;
  for (const [index, route] of routes.entries()) {
    try {
      const result = await pRetry(() => call(route), {
        retries: maxAttempts - 1,
        minTimeout: 1000,
        maxTimeout: 15_000,
        signal,
        shouldRetry: ({ error }) => toModelError(error, signal).transient,
        onFailedAttempt: ({ error }) => {
          const failure = toModelError(error, signal);
          attempts.push({ route: index, model: route.model, ok: false, error: failure.message, code: failure.code, ...(failure.usage ? { usage: failure.usage } : {}) });
        },
      });
      const usage = (result as { usage?: Usage } | null)?.usage;
      attempts.push({ route: index, model: route.model, ok: true, ...(usage ? { usage } : {}) });
      return { result, route, attempts };
    } catch (error) {
      last = toModelError(error, signal);
      if (!last.transient) break;
    }
  }
  throw Object.assign(last ?? new ModelError('config', '사용할 AI 경로가 없습니다.', false), { attempts });
}
