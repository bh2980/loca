import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { PI_BUILTIN_TOOLS, piOptionsSchema, type PiOptions } from '@tw/shared';
import { Type } from 'typebox';
import { z } from 'zod';
import { ModelError } from './errors.ts';
import type { GenerateRequest, GenerateResult, ResolvedRoute, Usage } from './types.ts';

/**
 * pi (the coding agent) used as a library. Credentials are pi's own: whatever the user signed in
 * to with `pi` → `/login` (subscriptions over OAuth, or API keys) lives in pi's auth.json, so the
 * workbench never stores them. Models are addressed as "<provider>/<model id>".
 */
let runtime: Promise<ModelRuntime> | null = null;
/** WORKBENCH_PI_DIR points pi at a separate auth.json / models.json (tests against the mock LLM). */
const piDir = process.env.WORKBENCH_PI_DIR;
export const piRuntime = () =>
  (runtime ??= ModelRuntime.create(piDir ? { authPath: path.join(piDir, 'auth.json'), modelsPath: path.join(piDir, 'models.json') } : undefined).then(async (rt) => {
    // Custom providers from models.json are resolved on the first availability check, not at create.
    await rt.getAvailable();
    return rt;
  }));

/** Forget cached credentials, e.g. after the user signed in to another provider in pi. */
export function resetPiRuntime() {
  runtime = null;
}

export async function piModels(): Promise<string[]> {
  const models = await (await piRuntime()).getAvailable();
  return models.map((model) => `${model.provider}/${model.id}`).sort();
}

/** pi knows each model's window and output limit. */
export async function piModelLimits(): Promise<Record<string, { contextWindow?: number; maxOutput?: number }>> {
  const models = await (await piRuntime()).getAvailable();
  return Object.fromEntries(models.map((model) => [`${model.provider}/${model.id}`, { ...(model.contextWindow > 0 && { contextWindow: model.contextWindow }), ...(model.maxTokens > 0 && { maxOutput: model.maxTokens }) }]));
}

export async function piModel(id: string) {
  const slash = id.indexOf('/');
  if (slash < 1) throw new ModelError('config', `pi 모델은 "공급자/모델" 형식이어야 합니다: ${id}`, false);
  const rt = await piRuntime();
  const model = rt.getModel(id.slice(0, slash), id.slice(slash + 1));
  if (!model) throw new ModelError('config', `pi에서 찾을 수 없는 모델입니다: ${id}. pi에서 /login 했는지 확인하세요.`, false);
  if (!rt.hasConfiguredAuth(model.provider)) throw new ModelError('auth', `pi에 ${model.provider} 로그인이 없습니다. 터미널에서 pi를 열고 /login 하세요.`, false);
  return { runtime: rt, model };
}

export async function piProbe(): Promise<string> {
  const models = await piModels();
  if (!models.length) throw new ModelError('auth', 'pi에 로그인된 공급자가 없습니다. 터미널에서 pi를 열고 /login 하세요.', false);
  const providers = new Set(models.map((model) => model.split('/')[0]));
  return `pi 로그인 ${providers.size}곳, 모델 ${models.length}개를 확인했습니다.`;
}

const THINKING = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

/** pi counts cache outside `input`. Its `cost.total` comes from pi's price catalog, so it is not reported cost. */
const piUsage = (usage: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number }): Usage => ({
  inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
  cachedInputTokens: usage.cacheRead,
  outputTokens: usage.output,
  ...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
});

function parseJson(text: string, usage?: Usage): unknown {
  const clean = text.trim();
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(clean);
  try {
    return JSON.parse(fenced?.[1] ?? clean);
  } catch {
    throw new ModelError('invalid-output', '모델 응답이 JSON이 아닙니다.', false, usage);
  }
}

/** One structured call without tools: the schema goes into the prompt, the answer must be that JSON. */
export async function piGenerate<T>(route: ResolvedRoute, request: GenerateRequest<T>): Promise<GenerateResult<T>> {
  const { runtime: rt, model } = await piModel(route.model);
  const schema = JSON.stringify(z.toJSONSchema(request.schema, { target: 'draft-7' }));
  const message = await rt.completeSimple(
    model,
    {
      systemPrompt: `${request.system}\n\n응답은 다음 JSON Schema를 따르는 JSON 하나만 출력하세요. 설명이나 코드 블록 바깥 글은 쓰지 마세요.\n${schema}`,
      messages: [{ role: 'user', content: request.prompt, timestamp: Date.now() }],
    },
    {
      maxTokens: request.maxOutputTokens,
      temperature: request.temperature,
      signal: AbortSignal.any([AbortSignal.timeout(request.timeoutMs), ...(request.signal ? [request.signal] : [])]),
      ...(route.effort && THINKING.has(route.effort) ? { reasoning: route.effort as never } : {}),
    },
  );
  const usage = piUsage(message.usage);
  if (message.stopReason === 'aborted') throw new ModelError(request.signal?.aborted ? 'cancelled' : 'timeout', '호출이 중단되었습니다.', undefined, usage);
  if (message.stopReason === 'error') throw new ModelError('network', message.errorMessage ?? 'pi 호출이 실패했습니다.', undefined, usage);
  if (message.stopReason === 'length') throw new ModelError('invalid-output', '응답이 길이 제한에 걸려 잘렸습니다.', false, usage);
  const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
  const parsed = request.schema.safeParse(parseJson(text, usage));
  if (!parsed.success) throw new ModelError('invalid-output', `응답 형식이 맞지 않습니다: ${parsed.error.issues[0]?.message ?? ''}`, false, usage);
  return { object: parsed.data, usage };
}

// ── sessions with the user's pi setup ─────────────────────────────

export type { AgentSession as PiSession };

/** A workbench tool handed to pi: plain JSON Schema in, text for the model (plus details for the UI) out. */
export interface PiToolSpec {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<{ text: string; details?: unknown }>;
}

const BUILTIN = Object.keys(PI_BUILTIN_TOOLS) as (keyof typeof PI_BUILTIN_TOOLS)[];
const agentDir = () => piDir ?? path.join(homedir(), '.pi', 'agent');

/**
 * A pi session shaped by the connection's switches: the user's packages/extensions (minus any
 * switched off), only the pi file/shell tools they turned on, skills/prompt templates/AGENTS.md
 * only on request. Our system prompt replaces pi's coding prompt; the workbench tools are added.
 */
/** Earlier conversation a new pi session starts with (the chat record, see apps/server chat-context.ts). */
export interface PiHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** A session record holding the history as plain user/assistant messages; the model reads it as its own past turns. */
function historySession(cwd: string, history: PiHistoryMessage[], model: { api: string; provider: string; id: string } | undefined) {
  const manager = SessionManager.inMemory(cwd);
  for (const message of history) {
    const timestamp = Date.now();
    if (message.role === 'user') manager.appendMessage({ role: 'user', content: message.text, timestamp } as never);
    else manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: message.text }], api: model?.api ?? 'unknown', provider: model?.provider ?? 'unknown', model: model?.id ?? 'unknown', usage: EMPTY_USAGE, stopReason: 'stop', timestamp } as never);
  }
  return manager;
}

async function openSession(options: { piOptions: PiOptions; model?: string; effort?: string; system: string; tools: PiToolSpec[]; start?: boolean; history?: PiHistoryMessage[] }) {
  const pi = options.piOptions;
  const rt = await piRuntime();
  const cwd = pi.cwd.trim() || tmpdir();
  const disabled = new Set(pi.disabledExtensions);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: agentDir(),
    noExtensions: !pi.extensions,
    extensionsOverride: (base) => ({ ...base, extensions: base.extensions.filter((extension) => !disabled.has(extension.path)) }),
    noSkills: !pi.skills,
    noPromptTemplates: !pi.promptTemplates,
    noContextFiles: !pi.contextFiles,
    noThemes: true,
    systemPrompt: options.system,
  });
  await resourceLoader.reload();
  const model = options.model ? (await piModel(options.model)).model : undefined;
  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: options.effort && THINKING.has(options.effort) ? (options.effort as never) : 'off',
    modelRuntime: rt,
    resourceLoader,
    excludeTools: BUILTIN.filter((name) => !pi.builtinTools.includes(name)),
    customTools: options.tools.map((tool) =>
      defineTool({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: Type.Unsafe<Record<string, unknown>>(tool.parameters),
        execute: async (_id, params, signal) => {
          const result = await tool.execute(params as Record<string, unknown>, signal);
          return { content: [{ type: 'text', text: result.text }], details: (result.details ?? null) as never };
        },
      }),
    ),
    sessionManager: options.history?.length ? historySession(cwd, options.history, model as never) : SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 2 } }),
  });
  // Extensions start on session_start (web access, MCP servers, routers…). There is no terminal UI here.
  if (pi.extensions && options.start !== false) await session.bindExtensions({ mode: 'print' as never, onError: () => {} });
  return { session, resourceLoader, runtime: rt };
}

export async function createPiChatSession(options: { piOptions?: PiOptions; model: string; effort?: string; system: string; tools: PiToolSpec[]; history?: PiHistoryMessage[] }): Promise<AgentSession> {
  return (await openSession({ ...options, piOptions: options.piOptions ?? piOptionsSchema.parse({}) })).session;
}

/** What the connection would load, for the settings page: extensions, skills, prompt templates, context files. */
export async function piResources(piOptions?: PiOptions) {
  const options = { ...(piOptions ?? piOptionsSchema.parse({})), extensions: true, skills: true, promptTemplates: true, contextFiles: true, disabledExtensions: [] };
  // Listing only loads extension modules; their session_start handlers do not run.
  const { session, resourceLoader } = await openSession({ piOptions: options, system: '', tools: [], start: false });
  try {
    const extensions = resourceLoader.getExtensions();
    return {
      extensions: extensions.extensions
        .filter((extension) => !extension.hidden)
        .map((extension) => ({ path: extension.path, source: extension.sourceInfo.source, tools: [...extension.tools.keys()] })),
      errors: extensions.errors.map((error) => String((error as { error?: unknown }).error ?? error)),
      skills: resourceLoader.getSkills().skills.map((skill) => ({ name: skill.name, description: skill.description })),
      prompts: resourceLoader.getPrompts().prompts.map((prompt) => ({ name: (prompt as { name: string }).name })),
      contextFiles: resourceLoader.getAgentsFiles().agentsFiles.map((file) => (file as { path: string }).path),
      builtinTools: BUILTIN,
    };
  } finally {
    session.dispose();
  }
}

/** Models, including providers that extensions register (routers, extra accounts…) when extensions are on. */
export async function piModelsWith(piOptions?: PiOptions): Promise<string[]> {
  if (!piOptions?.extensions) return piModels();
  const { session, runtime: rt } = await openSession({ piOptions, system: '', tools: [], start: false });
  try {
    return (await rt.getAvailable()).map((model) => `${model.provider}/${model.id}`).sort();
  } finally {
    session.dispose();
  }
}
