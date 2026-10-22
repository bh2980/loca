import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output, type LanguageModel } from 'ai';
import { ModelError, readAiSdkUsage, toModelError } from './errors.ts';
import type { CompleteRequest, CompleteResult, GenerateRequest, GenerateResult, ModelLimitsInfo, ResolvedRoute } from './types.ts';

const PROVIDER = 'workbench';

function provider(route: ResolvedRoute) {
  if (!route.baseUrl) throw new ModelError('config', 'API 주소가 없습니다.', false);
  return createOpenAICompatible({
    name: PROVIDER,
    baseURL: route.baseUrl,
    apiKey: route.apiKey,
    supportsStructuredOutputs: true,
    includeUsage: true,
  });
}

export function openaiChatModel(route: ResolvedRoute): LanguageModel {
  return provider(route).chatModel(route.model);
}

export const openaiProviderOptions = (route: ResolvedRoute) =>
  route.effort ? { [PROVIDER]: { reasoningEffort: route.effort } } : undefined;

export async function openaiGenerate<T>(route: ResolvedRoute, request: GenerateRequest<T>): Promise<GenerateResult<T>> {
  try {
    const result = await generateText({
      model: openaiChatModel(route),
      system: request.system,
      prompt: request.prompt,
      output: Output.object({ schema: request.schema }),
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      providerOptions: openaiProviderOptions(route),
      maxRetries: 0, // retries are the workflow's business (a 재요청 node)
      abortSignal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)]) : AbortSignal.timeout(request.timeoutMs),
    });
    return {
      object: result.output as T,
      usage: readAiSdkUsage(result.usage),
    };
  } catch (error) {
    throw toModelError(error, request.signal);
  }
}

export async function openaiComplete(route: ResolvedRoute, request: CompleteRequest): Promise<CompleteResult> {
  try {
    const result = await generateText({
      model: openaiChatModel(route),
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens: request.maxOutputTokens,
      providerOptions: openaiProviderOptions(route),
      maxRetries: 0,
      abortSignal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)]) : AbortSignal.timeout(request.timeoutMs),
    });
    return { text: result.text, usage: readAiSdkUsage(result.usage) };
  } catch (error) {
    throw toModelError(error, request.signal);
  }
}

export async function openaiModels(route: Omit<ResolvedRoute, 'model'>): Promise<string[]> {
  return (await openaiModelList(route)).ids;
}

/** A positive whole number from a field providers name differently, or undefined. */
const tokens = (...values: unknown[]) => values.map((value) => (typeof value === 'string' ? Number(value) : value)).find((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0);

/**
 * The limits a model list says, under the names providers use: OpenRouter (context_length,
 * top_provider.max_completion_tokens), Groq (context_window, max_completion_tokens), vLLM
 * (max_model_len) and others (max_context_length, max_input_tokens, max_output_tokens).
 */
export function limitsOf(item: Record<string, unknown>): ModelLimitsInfo | undefined {
  const top = (item.top_provider ?? {}) as Record<string, unknown>;
  const contextWindow = tokens(item.context_length, item.context_window, item.max_context_length, item.max_model_len, top.context_length, item.max_input_tokens);
  const maxOutput = tokens(top.max_completion_tokens, item.max_completion_tokens, item.max_output_tokens, item.max_tokens);
  return contextWindow || maxOutput ? { ...(contextWindow && { contextWindow }), ...(maxOutput && { maxOutput }) } : undefined;
}

/** The model list with what it says about each model's limits. */
export async function openaiModelList(route: Omit<ResolvedRoute, 'model'>): Promise<{ ids: string[]; limits: Record<string, ModelLimitsInfo> }> {
  if (!route.baseUrl) throw new ModelError('config', 'API 주소가 없습니다.', false);
  const response = await fetch(`${route.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: route.apiKey ? { Authorization: `Bearer ${route.apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  }).catch((error) => {
    throw toModelError(error);
  });
  const url = `${route.baseUrl.replace(/\/+$/, '')}/models`;
  if (response.status === 401 || response.status === 403) throw new ModelError('auth', '인증에 실패했습니다. API 키를 확인하세요.', false);
  if (response.status === 404)
    throw new ModelError('config', `${url} 이 없습니다(HTTP 404). API 주소가 맞는지 확인하세요. OpenAI 호환 API는 보통 …/v1 로 끝납니다.`, false);
  if (!response.ok) throw new ModelError('network', `모델 목록 요청이 실패했습니다 (HTTP ${response.status}).`);
  // A web page instead of JSON almost always means the address is the site, not its API.
  const text = await response.text();
  let body: { data?: Record<string, unknown>[] };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    const html = /^\s*</.test(text);
    throw new ModelError(
      'config',
      html
        ? `${url} 에서 API 응답(JSON)이 아니라 웹 페이지(HTML)가 왔습니다. 기본 주소에 사이트 주소가 아니라 API 주소를 넣으세요. OpenAI 호환 API는 보통 https://…/v1 처럼 끝납니다.`
        : `${url} 의 응답이 JSON이 아닙니다: ${text.slice(0, 120)}`,
      false,
    );
  }
  const items = (body.data ?? []).filter((item): item is Record<string, unknown> & { id: string } => typeof item?.id === 'string');
  const limits = Object.fromEntries(items.flatMap((item) => {
    const found = limitsOf(item);
    return found ? [[item.id, found]] : [];
  }));
  return { ids: items.map((item) => item.id).sort(), limits };
}
