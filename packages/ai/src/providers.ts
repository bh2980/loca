import type { LanguageModel } from 'ai';
import { CLI_KINDS, type CliKind, type ConnectionKind } from '@tw/shared';
import { agentFor, agentWith, checkCliLogin, type AcpAgent } from './acp.ts';
import { cliGenerate, cliModelList, cliVersion, describeCli, LOGIN_COMMANDS, openLoginTerminal } from './cli.ts';
import { ModelError } from './errors.ts';
import { openaiChatModel, openaiComplete, openaiGenerate, openaiModelList, openaiProviderOptions } from './openai.ts';
import { systemOneAsk, systemOneModels } from './systemone.ts';
import type { AskRequest, AskResult, CompleteRequest, CompleteResult, ConnectionTarget, GenerateRequest, GenerateResult, ModelLimitsInfo, ModelTarget } from './types.ts';

/** A connection's models, with what its list says about each model's limits. `models` null: it has no list, the person types the id. */
export interface ModelCatalog {
  models: string[] | null;
  limits: Record<string, ModelLimitsInfo>;
}

/** How the project chat talks to a connection. */
export type ChatTransport =
  /** An AI SDK model that calls the workbench tools natively. */
  | { via: 'api'; model: (target: ModelTarget) => LanguageModel; options: (target: ModelTarget) => ReturnType<typeof openaiProviderOptions> }
  /** The CLI's own agent over ACP (acp.ts): one long-lived process, a session per conversation. */
  | { via: 'agent'; start: (executable?: string) => Promise<AcpAgent>; resume: (executable: string | undefined, sessionId: string) => Promise<AcpAgent | null> };

/**
 * What one connection kind can do and how. A member that is absent is something the kind cannot do:
 * CONNECTION_KIND_INFO[kind].capabilities says the same to the screens, and providers.test.ts holds the
 * two together (generate ↔ generate, judge ↔ ask, chat ↔ chat, complete ↔ complete).
 */
export interface Provider {
  /** Structured generation: an answer that follows the request's schema. */
  generate?: <T>(target: ModelTarget, request: GenerateRequest<T>) => Promise<GenerateResult<T>>;
  /** Plain text from a prompt, fast enough to follow typing. */
  complete?: (target: ModelTarget, request: CompleteRequest) => Promise<CompleteResult>;
  /** Typed questions (yes/no, choice, score) about a state: a judgment, not writing. */
  ask?: (target: ModelTarget, request: AskRequest) => Promise<AskResult>;
  chat?: ChatTransport;
  /** The models it serves. */
  models: (target: ConnectionTarget) => Promise<ModelCatalog>;
  /** Cheap reachability check, as a sentence for the person. */
  probe: (target: ConnectionTarget) => Promise<string>;
  /** An agent CLI on this computer: where its executable is, and its own login. */
  cli?: {
    /** The command it runs (the field, or the kind's default), the file that resolves to (null when none), and its --version line. */
    locate: (executable?: string) => Promise<{ command: string; resolved: string | null; version: string | null }>;
    loginStatus: (executable?: string) => Promise<'signed-in' | 'signed-out'>;
    /** Opens the CLI's own login in a terminal window; returns the command it ran. */
    openLogin: (executable?: string) => Promise<string>;
  };
}

const countModels = async (list: Promise<ModelCatalog>) => `모델 ${(await list).models?.length ?? 0}개를 확인했습니다.`;

const openai: Provider = {
  generate: openaiGenerate,
  complete: openaiComplete,
  chat: { via: 'api', model: openaiChatModel, options: openaiProviderOptions },
  models: async (target) => {
    const list = await openaiModelList(target);
    return { models: list.ids, limits: list.limits };
  },
  probe: (target) => countModels(openai.models(target)),
};

const systemone: Provider = {
  ask: systemOneAsk,
  models: async (target) => ({ models: await systemOneModels(target), limits: {} }),
  probe: (target) => countModels(systemone.models(target)),
};

/** An API key for the workflow's HTTP function: no model behind it, only an address to reach. */
const http: Provider = {
  models: async () => ({ models: null, limits: {} }),
  probe: async (target) => {
    const response = await fetch(target.baseUrl ?? '', { signal: AbortSignal.timeout(10_000) }).catch(() => {
      throw new ModelError('network', '주소에 연결하지 못했습니다.');
    });
    return `서버가 응답했습니다 (HTTP ${response.status}).`;
  },
};

/** An agent CLI: one-shot runs for structured generation (cli.ts), its ACP agent for chat (acp.ts). */
const cli = (kind: CliKind): Provider => ({
  generate: cliGenerate,
  chat: { via: 'agent', start: (executable) => agentFor(kind, executable), resume: (executable, sessionId) => agentWith(kind, executable, sessionId) },
  models: async (target) => {
    const list = await cliModelList(kind, target.executable);
    return { models: list?.models ?? null, limits: list?.limits ?? {} };
  },
  probe: async (target) => {
    const version = await cliVersion(kind, target.executable);
    const { resolved } = describeCli(kind, target.executable);
    return resolved ? `CLI ${version} · ${resolved}` : `CLI ${version}`;
  },
  cli: {
    locate: async (executable) => {
      const { command, resolved } = describeCli(kind, executable);
      return { command, resolved, version: resolved ? await cliVersion(kind, executable).catch(() => null) : null };
    },
    loginStatus: (executable) => checkCliLogin(kind, executable),
    openLogin: async (executable) => {
      await openLoginTerminal(kind, executable);
      return [executable || kind, ...LOGIN_COMMANDS[kind]].join(' ');
    },
  },
});

/** One provider per connection kind: everything that depends on the kind is asked here. */
export const PROVIDERS: Record<ConnectionKind, Provider> = {
  openai,
  systemone,
  ...(Object.fromEntries(CLI_KINDS.map((kind) => [kind, cli(kind)])) as Record<CliKind, Provider>),
  http,
};
