import type { LanguageModel } from 'ai';
import { CONNECTION_KIND_INFO, type Capability, type ConnectionKind } from '@loca/shared';
import { ModelError, toModelError } from './errors.ts';
import { PROVIDERS, type ModelCatalog, type Provider } from './providers.ts';
import type { AskRequest, AskResult, CompleteRequest, CompleteResult, ConnectionTarget, GenerateRequest, GenerateResult, ModelTarget } from './types.ts';

export * from './types.ts';
export { ModelError } from './errors.ts';
export { closeSession, setAgentStarter, stopIdleAgents } from './acp.ts';
export { hostTools, type HostedServer } from './mcp-host.ts';
export { limitsOf } from './openai.ts';
export { PROVIDERS, type ModelCatalog, type Provider } from './providers.ts';

/** The provider of a connection kind: what it can do, and how (providers.ts). */
export const providerOf = (kind: ConnectionKind): Provider => PROVIDERS[kind];

/** What to tell a person whose connection cannot do what was asked of it. */
const cannot = (kind: ConnectionKind, capability: Capability) => {
  const label = CONNECTION_KIND_INFO[kind].label;
  const what: Record<Capability, string> = {
    generate: `${label} 연결은 글을 쓰지 못합니다. AI 노드·편집기에는 생성 연결을 고르세요.`,
    judge: `${label} 연결은 판정 전용 연결이 아닙니다.`,
    chat: `${label} 연결은 채팅(도구 호출)을 지원하지 않습니다.`,
    complete: `편집기 자동완성은 API 연결(OpenAI 호환)만 쓸 수 있습니다.`,
    tool: `${label} 연결은 HTTP 호출의 API 키로 쓸 수 없습니다.`,
  };
  return new ModelError('config', what[capability], false);
};

/** Structured generation. Throws a config error for a kind that does not write (a judgment connection, an API key). */
export function generate<T>(target: ModelTarget, request: GenerateRequest<T>): Promise<GenerateResult<T>> {
  const run = PROVIDERS[target.kind].generate;
  if (!run) throw cannot(target.kind, 'generate');
  return run(target, request);
}

/** Plain text for the editor. */
export function complete(target: ModelTarget, request: CompleteRequest): Promise<CompleteResult> {
  const run = PROVIDERS[target.kind].complete;
  if (!run) throw cannot(target.kind, 'complete');
  return run(target, request);
}

/** Typed questions (yes/no, choice, score) for a judgment model. */
export function ask(target: ModelTarget, request: AskRequest): Promise<AskResult> {
  const run = PROVIDERS[target.kind].ask;
  if (!run) throw cannot(target.kind, 'judge');
  return run(target, request);
}

/** The AI SDK model of a connection that chats through the API, with its call options. An agent CLI chats through its own agent (providerOf(kind).chat). */
export function chatModel(target: ModelTarget): { model: LanguageModel; providerOptions: ReturnType<Extract<NonNullable<Provider['chat']>, { via: 'api' }>['options']> } {
  const chat = PROVIDERS[target.kind].chat;
  if (chat?.via !== 'api') throw cannot(target.kind, 'chat');
  return { model: chat.model(target), providerOptions: chat.options(target) };
}

/**
 * The model list with what it says about each model's limits: an API's model list, or a CLI's own
 * list and cache files (codex, grok, opencode; claude and antigravity say nothing). One request or run.
 */
export const listModelCatalog = (target: ConnectionTarget): Promise<ModelCatalog> => PROVIDERS[target.kind].models(target);

/** Cheap reachability check: API → model list, CLI → `--version`, an API key's address → any response. */
export const probe = (target: ConnectionTarget): Promise<string> => PROVIDERS[target.kind].probe(target);

/**
 * One call: no retry, no other connection. A failure is thrown as a ModelError (with what the call used
 * before it failed); what happens next is the workflow's business (an AI node's retry rules), or the
 * person's, where there is no workflow.
 */
export async function callOnce<R>(call: () => Promise<R>, signal?: AbortSignal): Promise<R> {
  try {
    return await call();
  } catch (error) {
    throw toModelError(error, signal);
  }
}
