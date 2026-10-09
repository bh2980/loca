import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { z } from 'zod';
import { ModelError } from './errors.ts';
import type { GenerateRequest, GenerateResult, ResolvedRoute } from './types.ts';

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

function parseJson(text: string): unknown {
  const clean = text.trim();
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(clean);
  try {
    return JSON.parse(fenced?.[1] ?? clean);
  } catch {
    throw new ModelError('invalid-output', '모델 응답이 JSON이 아닙니다.', false);
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
  if (message.stopReason === 'aborted') throw new ModelError(request.signal?.aborted ? 'cancelled' : 'timeout', '호출이 중단되었습니다.');
  if (message.stopReason === 'error') throw new ModelError('network', message.errorMessage ?? 'pi 호출이 실패했습니다.');
  if (message.stopReason === 'length') throw new ModelError('invalid-output', '응답이 길이 제한에 걸려 잘렸습니다.', false);
  const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
  const parsed = request.schema.safeParse(parseJson(text));
  if (!parsed.success) throw new ModelError('invalid-output', `응답 형식이 맞지 않습니다: ${parsed.error.issues[0]?.message ?? ''}`, false);
  return { object: parsed.data, usage: { inputTokens: message.usage.input, outputTokens: message.usage.output } };
}

// ── chat ────────────────────────────────────────────────────────────

export type { AgentSession as PiSession };

/** A workbench tool handed to pi: plain JSON Schema in, text for the model (plus details for the UI) out. */
export interface PiToolSpec {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<{ text: string; details?: unknown }>;
}

/**
 * A pi agent session that only knows the workbench: pi's own coding tools (files, shell) are off,
 * no extensions, skills or context files are loaded, and the system prompt is ours.
 */
export async function createPiChatSession(options: { model: string; effort?: string; system: string; tools: PiToolSpec[] }): Promise<AgentSession> {
  const { runtime: rt, model } = await piModel(options.model);
  const system = options.system;
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => system,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  const cwd = tmpdir();
  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: options.effort && THINKING.has(options.effort) ? (options.effort as never) : 'off',
    modelRuntime: rt,
    resourceLoader,
    noTools: 'builtin',
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
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 2 } }),
  });
  return session;
}
