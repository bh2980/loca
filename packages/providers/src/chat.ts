import { Ajv, type ValidateFunction } from 'ajv';
import { ChatStreamAssembler, SSEDecoder } from './chat-stream.js';
import { apiUrl } from './api.js';
import { normalizeUsage, object } from './output.js';
import { ProviderError, type ProviderConnection } from './types.js';
import type { ChatCapability, ChatDependencies, ChatMessage, ChatRequest, ChatResult, ChatToolCall } from './chat-types.js';

const INPUT_LIMIT = 2 * 1024 * 1024, OUTPUT_LIMIT = 8 * 1024 * 1024;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
function fail(code: string, message: string): never { throw new ProviderError(code, message); }
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\0]/.test(value); }
function json(text: string): unknown {
  try { return JSON.parse(text); } catch { return fail('invalid-json', '채팅 API가 올바른 JSON을 반환하지 않았습니다.'); }
}

/** Never probes accounts, launches a CLI, or calls a model. */
export function chatCapability(connection: ProviderConnection): ChatCapability {
  if (connection.kind !== 'openai') return { supported: false, streaming: false, detail: connection.kind === 'systemone'
    ? 'System One은 판정 전용 API이며 채팅 도구 호출을 지원하지 않습니다.'
    : '이 연결의 채팅 도구 호출 어댑터는 아직 구현되지 않았습니다.' };
  try {
    apiUrl(connection);
    if (connection.apiMode !== undefined && !['chat', 'responses'].includes(connection.apiMode)) fail('invalid-api-mode', '지원하지 않는 채팅 API 방식입니다.');
    return { supported: true, protocol: connection.apiMode ?? 'chat', streaming: true, detail: '채팅 도구 호출 어댑터를 사용할 수 있습니다. 서버·모델 지원과 인증은 실제 호출로 확인해야 합니다.' };
  } catch (error) {
    return { supported: false, streaming: false, detail: error instanceof ProviderError ? error.message : 'API 설정을 확인하지 못했습니다.' };
  }
}

function validateRequest(request: ChatRequest): Map<string, ValidateFunction> {
  const capability = chatCapability(request.connection), { profile } = request;
  if (!capability.supported) fail('unsupported-chat-provider', capability.detail);
  if (profile.connectionId !== request.connection.id) fail('profile-connection-mismatch', '프로필과 선택한 연결이 일치하지 않습니다.');
  if (typeof profile.model !== 'string' || !profile.model.trim() || profile.model.length > 256 || /[\r\n\0]/.test(profile.model)) fail('missing-model', '유효한 모델 ID를 입력하세요.');
  if (!Number.isFinite(profile.timeoutMs) || profile.timeoutMs <= 0 || profile.timeoutMs > 3_600_000) fail('invalid-timeout', '호출 제한 시간은 1ms~1시간 범위여야 합니다.');
  if (!Number.isSafeInteger(profile.maxOutputTokens) || profile.maxOutputTokens < 1) fail('invalid-output-limit', '출력 토큰 한도는 양의 정수여야 합니다.');
  if (profile.effort && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(profile.effort)) fail('unsupported-effort', '지원하지 않는 추론 수준입니다.');
  if (request.connection.tokenLimitField && !['max_completion_tokens', 'max_tokens'].includes(request.connection.tokenLimitField)) fail('invalid-token-field', '지원하지 않는 API 토큰 한도 필드입니다.');
  if (!Array.isArray(request.messages) || !request.messages.length || request.messages.length > 512) fail('invalid-messages', '채팅 메시지는 1~512개여야 합니다.');
  const calls = new Set<string>(), pending = new Set<string>();
  for (const message of request.messages) {
    if (!message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string') fail('invalid-messages', '채팅 메시지 형식이 잘못되었습니다.');
    if (message.role === 'tool') {
      if (!id(message.toolCallId) || !pending.delete(message.toolCallId)) fail('invalid-tool-history', '도구 결과가 대기 중인 호출과 일치하지 않습니다.');
    } else {
      if (pending.size) fail('invalid-tool-history', '대기 중인 도구 결과를 모두 전달하세요.');
      if (message.role === 'assistant') {
        if (message.toolCalls !== undefined && (!Array.isArray(message.toolCalls) || message.toolCalls.length > 64)) fail('invalid-tool-history', '도구 호출 기록의 형식이나 개수가 잘못되었습니다.');
        for (const call of message.toolCalls ?? []) {
          if (!call || !id(call.id) || typeof call.name !== 'string' || !NAME.test(call.name) || !object(call.arguments) || calls.has(call.id)) fail('invalid-tool-history', '도구 호출 ID·이름·인자가 잘못되거나 중복되었습니다.');
          calls.add(call.id); pending.add(call.id);
        }
        if (message.responseItems !== undefined) {
          const replay = parseResponsesOutput(message.responseItems);
          if (replay.message !== message.content || JSON.stringify(replay.toolCalls) !== JSON.stringify(message.toolCalls ?? [])) fail('invalid-tool-history', 'Responses 기록과 메시지·도구 호출이 일치하지 않습니다.');
        }
      }
    }
  }
  if (pending.size) fail('invalid-tool-history', '대기 중인 도구 결과를 모두 전달하세요.');
  if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length > 128)) fail('invalid-tools', '채팅 도구는 최대 128개까지 사용할 수 있습니다.');
  const validators = new Map<string, ValidateFunction>(), ajv = new Ajv({ strict: false, allErrors: false });
  for (const tool of request.tools ?? []) {
    if (!tool || typeof tool.name !== 'string' || !NAME.test(tool.name) || validators.has(tool.name) || !object(tool.parameters) || tool.parameters.type !== 'object'
      || (tool.description !== undefined && typeof tool.description !== 'string') || (tool.strict !== undefined && typeof tool.strict !== 'boolean')
      || tool.parameters.$async) fail('invalid-tools', '도구 이름·JSON Schema가 잘못되거나 중복되었습니다.');
    try { validators.set(tool.name, ajv.compile(tool.parameters)); } catch { fail('invalid-tool-schema', '도구 JSON Schema를 확인하지 못했습니다.'); }
  }
  return validators;
}

function normalizedCall(raw: unknown, responses: boolean): ChatToolCall {
  const row = object(raw), fn = responses ? row : object(row?.function), callId = responses ? row?.call_id : row?.id;
  if (row?.type !== (responses ? 'function_call' : 'function') || !id(callId) || typeof fn?.name !== 'string' || !NAME.test(fn.name)
    || typeof fn.arguments !== 'string' || Buffer.byteLength(fn.arguments, 'utf8') > 65536) fail('invalid-tool-call', 'API 도구 호출의 ID·이름·JSON 인자가 잘못되었습니다.');
  const args = object(json(fn.arguments));
  if (!args) fail('invalid-tool-arguments', '도구 인자는 JSON 객체여야 합니다.');
  return { id: callId, name: fn.name, arguments: args };
}

function parseResponsesOutput(output: unknown): Pick<ChatResult, 'message' | 'toolCalls' | 'responseItems'> {
  if (!Array.isArray(output) || output.length > 256) fail('invalid-response', 'Responses 출력 구조가 잘못되었습니다.');
  const texts: string[] = [], toolCalls: ChatToolCall[] = [], responseItems: Record<string, unknown>[] = [];
  for (const raw of output) {
    const item = object(raw);
    if (!item) fail('invalid-response', 'Responses 출력 항목이 잘못되었습니다.');
    if (item.status !== undefined && item.status !== 'completed') fail('incomplete-response', 'Responses 출력 항목이 완료되지 않았습니다.');
    if (item.type === 'function_call') toolCalls.push(normalizedCall(item, true));
    else if (item.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content)) fail('invalid-response', 'Responses 메시지 형식이 잘못되었습니다.');
      for (const rawPart of item.content) {
        const part = object(rawPart);
        if (part?.type === 'refusal') fail('refusal', '모델이 이 요청의 처리를 거절했습니다.');
        if (part?.type !== 'output_text' || typeof part.text !== 'string') fail('invalid-response', '지원하지 않는 Responses 메시지 내용입니다.');
        texts.push(part.text);
      }
    } else if (item.type === 'reasoning') {
      if (!Array.isArray(item.summary) || (item.encrypted_content !== undefined && item.encrypted_content !== null && typeof item.encrypted_content !== 'string')) fail('invalid-response', 'Responses 추론 연속 기록이 잘못되었습니다.');
    } else fail('unsupported-response-item', '설정한 함수 도구 외의 API 출력은 지원하지 않습니다.');
    responseItems.push(item);
  }
  return { message: texts.join(''), toolCalls, responseItems };
}

function serializeMessage(message: ChatMessage, responses: boolean): Record<string, unknown>[] {
  if (message.role === 'tool') return [responses
    ? { type: 'function_call_output', call_id: message.toolCallId, output: message.content }
    : { role: 'tool', tool_call_id: message.toolCallId, content: message.content }];
  if (message.role !== 'assistant') return [{ role: message.role, content: message.content }];
  const calls = message.toolCalls ?? [];
  if (!responses) return [{ role: 'assistant', content: message.content || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) }];
  if (message.responseItems) return message.responseItems;
  return [ ...(message.content || !calls.length ? [{ role: 'assistant', content: message.content }] : []),
    ...calls.map(call => ({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) })) ];
}

function authorization(request: ChatRequest): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (request.connection.envKey && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(request.connection.envKey)) fail('invalid-env-key', 'API 키 환경변수 이름이 올바르지 않습니다.');
  const key = request.credential ?? (request.connection.envKey ? process.env[request.connection.envKey] : undefined);
  if (key !== undefined) {
    if (typeof key !== 'string' || !key.trim() || /[\r\n\0]/.test(key)) fail('invalid-key', 'API 키 형식이 올바르지 않습니다.');
    headers.Authorization = `Bearer ${key}`;
  } else if (request.connection.envKey) fail('missing-key', '설정한 API 키 환경변수가 없습니다.');
  return headers;
}

/** One bounded JSON or SSE model turn. Never executes a returned tool or retries a paid request. */
export async function invokeChat(request: ChatRequest, dependencies: ChatDependencies = {}): Promise<ChatResult> {
  if (request.signal?.aborted) fail('cancelled', '작업이 취소되었습니다.');
  let serialized: string;
  try { serialized = JSON.stringify({ messages: request.messages, tools: request.tools }); } catch { return fail('invalid-messages', '채팅 입력은 JSON 데이터여야 합니다.'); }
  if (Buffer.byteLength(serialized, 'utf8') > INPUT_LIMIT) fail('input-limit', '채팅 입력 크기 제한을 초과했습니다.');
  const validators = validateRequest(request), { connection, profile } = request, responses = connection.apiMode === 'responses';
  const body: Record<string, unknown> = { model: profile.model, store: false, stream: request.stream === true };
  if (request.stream && !responses) body.stream_options = { include_usage: true };
  body[responses ? 'input' : 'messages'] = request.messages.flatMap(message => serializeMessage(message, responses));
  if (request.tools?.length) body.tools = request.tools.map(tool => {
    const definition = { name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }), parameters: tool.parameters, strict: tool.strict ?? false };
    return responses ? { type: 'function', ...definition } : { type: 'function', function: definition };
  });
  if (profile.effort) {
    if (responses) body.reasoning = { effort: profile.effort }; else body.reasoning_effort = profile.effort;
  }
  body[responses ? 'max_output_tokens' : connection.tokenLimitField ?? 'max_completion_tokens'] = profile.maxOutputTokens;
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload, 'utf8') > INPUT_LIMIT) fail('input-limit', '채팅 입력 크기 제한을 초과했습니다.');
  const headers = authorization(request), controller = new AbortController();
  const abort = () => controller.abort(), fetcher = dependencies.fetch ?? globalThis.fetch;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  request.signal?.addEventListener('abort', abort, { once: true });
  if (request.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, profile.timeoutMs);
  try {
    const operation = async (): Promise<ChatResult> => {
      const response = await fetcher(apiUrl(connection), { method: 'POST', headers, body: payload, signal: controller.signal, redirect: 'error' });
      if (controller.signal.aborted) throw new Error('aborted');
      if (!response.ok) fail('api-http-error', `채팅 API가 HTTP ${response.status}로 실패했습니다. 인증·모델·도구 지원을 확인하세요.`);
      reader = response.body?.getReader();
      if (!reader) fail('empty-response', '채팅 API 응답이 비어 있습니다.');
      const chunks: Uint8Array[] = []; let size = 0;
      const stream = response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ? new ChatStreamAssembler(responses, request.onText) : undefined;
      const decoder = stream ? new SSEDecoder(data => stream.accept(data)) : undefined;
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw new Error('aborted');
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > OUTPUT_LIMIT) { void reader.cancel().catch(() => {}); fail('output-limit', '채팅 API 응답 크기 제한을 초과했습니다.'); }
        if (decoder) decoder.feed(chunk.value); else chunks.push(chunk.value);
      }
      decoder?.end();
      const envelope = stream ? stream.result() : object(json(Buffer.concat(chunks).toString('utf8')));
      if (!envelope || envelope.error) fail('invalid-response', '채팅 API 응답 구조가 잘못되었습니다.');
      let result: Pick<ChatResult, 'message' | 'toolCalls' | 'responseItems'>;
      if (responses) {
        if (envelope.status !== 'completed') fail('incomplete-response', 'Responses API 결과가 완료되지 않았습니다.');
        result = parseResponsesOutput(envelope.output);
      } else {
        if (!Array.isArray(envelope.choices) || envelope.choices.length !== 1) fail('invalid-response', '채팅 API는 단일 응답을 반환해야 합니다.');
        const choice = object(envelope.choices[0]), message = object(choice?.message);
        if (message?.refusal || choice?.finish_reason === 'content_filter') fail('refusal', '모델이 이 요청의 처리를 거절했습니다.');
        if (!['stop', 'tool_calls'].includes(String(choice?.finish_reason))) fail('incomplete-response', 'Chat Completions 결과가 정상 완료되지 않았습니다.');
        if (!message || message.role !== 'assistant' || (message.content !== null && typeof message.content !== 'string')
          || (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))) fail('invalid-response', '채팅 API 메시지 구조가 잘못되었습니다.');
        const toolCalls = (message.tool_calls as unknown[] | undefined ?? []).map(call => normalizedCall(call, false));
        if (choice?.finish_reason === 'tool_calls' && !toolCalls.length) fail('invalid-tool-call', 'API가 도구 호출 완료 상태에 호출을 반환하지 않았습니다.');
        result = { message: message.content as string ?? '', toolCalls };
      }
      if (result.toolCalls.length > 64) fail('output-limit', '한 응답의 도구 호출 개수 제한을 초과했습니다.');
      const seen = new Set(request.messages.flatMap(message => message.role === 'assistant' ? (message.toolCalls ?? []).map(call => call.id) : []));
      for (const call of result.toolCalls) {
        if (seen.has(call.id)) fail('invalid-tool-call', 'API가 중복된 도구 호출 ID를 반환했습니다.');
        seen.add(call.id);
        const validate = validators.get(call.name);
        if (!validate) fail('unknown-tool', '모델이 허용 목록에 없는 도구를 요청했습니다.');
        if (!validate(call.arguments)) fail('invalid-tool-arguments', '도구 인자가 허용된 JSON Schema와 일치하지 않습니다.');
      }
      if (result.message.length > 100000) fail('output-limit', '채팅 텍스트 크기 제한을 초과했습니다.');
      if (!result.message.trim() && !result.toolCalls.length) fail('missing-result', 'API가 메시지나 도구 호출을 반환하지 않았습니다.');
      return { ...result, usage: normalizeUsage(envelope.usage), reportedModel: typeof envelope.model === 'string' ? envelope.model : undefined };
    };
    return await Promise.race([operation(), aborted]);
  } catch (error) {
    void reader?.cancel().catch(() => {});
    if (controller.signal.aborted) { void reader?.cancel().catch(() => {}); fail(request.signal?.aborted ? 'cancelled' : 'timeout', request.signal?.aborted ? '작업이 취소되었습니다.' : '채팅 API 호출 제한 시간을 초과했습니다.'); }
    if (error instanceof ProviderError) throw error;
    return fail('api-network-error', '채팅 API에 연결하지 못했습니다. 주소·네트워크·TLS 설정을 확인하세요.');
  } finally { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); }
}
