import { ProviderError } from './types.js';
import { object } from './output.js';

function fail(message: string): never { throw new ProviderError('invalid-stream', message); }
const MAX_TEXT = 100000, MAX_ARGS = 65536;
/** Assemble a single turn. Only text is exposed before the terminal event; tools stay private. */
export class ChatStreamAssembler {
  private text = ''; private done = false; private finish?: string;
  private model?: string; private usage?: unknown; private envelope?: Record<string, unknown>;
  private calls = new Map<number, { id?: string; type?: string; name?: string; arguments: string }>();
  private responseText = new Map<string, string>(); private responseArgs = new Map<string, string>();
  constructor(private responses: boolean, private onText?: (text: string) => void) {}
  private publish(delta: unknown) {
    if (typeof delta !== 'string') fail('스트림 텍스트가 잘못되었습니다.');
    this.text += delta;
    if (this.text.length > MAX_TEXT) throw new ProviderError('output-limit', '채팅 텍스트 크기 제한을 초과했습니다.');
    if (delta) this.onText?.(this.text);
  }
  accept(data: string) {
    if (data === '[DONE]') { if (this.responses || !this.finish || this.done) fail('스트림 종료 표시가 잘못되었습니다.'); this.done = true; return; }
    if (this.done) fail('완료된 스트림에 추가 결과가 있습니다.');
    let row: Record<string, unknown> | undefined;
    try { row = object(JSON.parse(data)); } catch { fail('스트림 이벤트 JSON이 잘못되었습니다.'); }
    if (!row || row.error) fail('스트림 API가 오류를 반환했습니다.');
    if (this.responses) { this.acceptResponses(row); return; }
    if (typeof row.model === 'string') { if (this.model && this.model !== row.model) fail('스트림 모델이 변경되었습니다.'); this.model = row.model; }
    if (row.usage != null) this.usage = row.usage;
    if (!Array.isArray(row.choices) || row.choices.length > 1) fail('스트림은 단일 응답이어야 합니다.');
    if (!row.choices.length) { if (!row.usage || !this.finish) fail('빈 스트림 응답입니다.'); return; }
    if (this.finish) fail('완료된 응답에 추가 델타가 있습니다.');
    const choice = object(row.choices[0]), delta = object(choice?.delta);
    if (choice?.index !== 0 || !delta || delta.refusal) fail('스트림 응답 구조나 거절 상태가 잘못되었습니다.');
    if (delta.role !== undefined && delta.role !== 'assistant') fail('스트림 메시지 역할이 잘못되었습니다.');
    if (delta.content != null) this.publish(delta.content);
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls)) fail('스트림 도구 목록이 잘못되었습니다.');
      for (const raw of delta.tool_calls) {
        const call = object(raw), index = call?.index;
        if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= 64) fail('스트림 도구 인덱스가 잘못되었습니다.');
        const entry = this.calls.get(Number(index)) ?? { arguments: '' }, fn = object(call?.function);
        for (const field of ['id', 'type'] as const) if (call?.[field] !== undefined) {
          if (typeof call[field] !== 'string' || entry[field] && entry[field] !== call[field]) fail('스트림 도구 ID가 변경되었습니다.');
          entry[field] = call[field];
        }
        if (fn?.name !== undefined) { if (typeof fn.name !== 'string' || entry.name && entry.name !== fn.name) fail('스트림 도구 이름이 변경되었습니다.'); entry.name = fn.name; }
        if (fn?.arguments !== undefined) { if (typeof fn.arguments !== 'string') fail('스트림 도구 인자가 잘못되었습니다.'); entry.arguments += fn.arguments; }
        if (Buffer.byteLength(entry.arguments) > MAX_ARGS) throw new ProviderError('output-limit', '도구 인자 크기 제한을 초과했습니다.');
        this.calls.set(Number(index), entry);
      }
    }
    if (choice.finish_reason != null) {
      if (!['stop', 'tool_calls'].includes(String(choice.finish_reason))) throw new ProviderError('incomplete-response', '채팅 스트림이 정상 완료되지 않았습니다.');
      this.finish = String(choice.finish_reason);
    }
  }
  private acceptResponses(row: Record<string, unknown>) {
    const type = row.type;
    if (type === 'response.completed') {
      const response = object(row.response);
      if (response?.status !== 'completed' || !Array.isArray(response.output)) fail('Responses 스트림이 완료되지 않았습니다.');
      const finalTexts: string[] = [], finalArgs = new Set<string>();
      for (const raw of response.output) {
        const item = object(raw);
        if (item?.type === 'message' && Array.isArray(item.content)) for (const rawPart of item.content) {
          const part = object(rawPart); if (part?.type === 'output_text' && typeof part.text === 'string') finalTexts.push(part.text);
        }
        if (item?.type === 'function_call') {
          finalArgs.add(String(item.id));
          if (this.responseArgs.has(String(item.id)) && item.arguments !== this.responseArgs.get(String(item.id))) fail('완료한 도구 인자가 스트림과 다릅니다.');
        }
      }
      if ([...this.responseArgs.keys()].some(id => !finalArgs.has(id))) fail('스트림 도구 호출이 최종 결과에서 누락되었습니다.');
      if (this.responseText.size && finalTexts.join('') !== this.text) fail('완료한 텍스트가 스트림과 다릅니다.');
      this.envelope = response; this.done = true; return;
    }
    if (type === 'response.output_text.delta') {
      const key = this.responseKey(row);
      this.responseText.set(key, (this.responseText.get(key) ?? '') + String(row.delta ?? ''));
      this.publish(row.delta); return;
    }
    if (type === 'response.function_call_arguments.delta') {
      if (typeof row.item_id !== 'string' || typeof row.delta !== 'string') fail('Responses 도구 델타가 잘못되었습니다.');
      const args = (this.responseArgs.get(row.item_id) ?? '') + row.delta;
      if (Buffer.byteLength(args) > MAX_ARGS || this.responseArgs.size >= 64 && !this.responseArgs.has(row.item_id)) throw new ProviderError('output-limit', '도구 인자 크기 제한을 초과했습니다.');
      this.responseArgs.set(row.item_id, args); return;
    }
    if (type === 'response.output_text.done') { const value = this.responseText.get(this.responseKey(row)); if (value !== undefined && row.text !== value) fail('Responses 완료 텍스트가 다릅니다.'); return; }
    if (type === 'response.function_call_arguments.done') {
      if (typeof row.item_id !== 'string' || typeof row.arguments !== 'string' || Buffer.byteLength(row.arguments) > MAX_ARGS) fail('Responses 완료 도구 인자가 잘못되었습니다.');
      const value = this.responseArgs.get(row.item_id); if (value !== undefined && row.arguments !== value) fail('Responses 완료 도구 인자가 다릅니다.');
      this.responseArgs.set(row.item_id, row.arguments); return;
    }
    const allowed = ['response.created', 'response.in_progress', 'response.output_item.added', 'response.output_item.done', 'response.content_part.added', 'response.content_part.done', 'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done', 'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done', 'response.reasoning_text.delta', 'response.reasoning_text.done'];
    if (!allowed.includes(String(type))) fail('지원하지 않거나 실패한 Responses 스트림 이벤트입니다.');
  }
  private responseKey(row: Record<string, unknown>) {
    if (typeof row.item_id !== 'string' || !Number.isInteger(row.output_index) || !Number.isInteger(row.content_index)) fail('Responses 텍스트 인덱스가 잘못되었습니다.');
    return `${row.output_index}:${row.content_index}:${row.item_id}`;
  }
  result(): Record<string, unknown> {
    if (!this.done) throw new ProviderError('incomplete-response', '채팅 스트림이 완료 전에 끊겼습니다.');
    if (this.responses) return this.envelope!;
    const indices = [...this.calls.keys()].sort((a, b) => a - b);
    if (indices.some((index, position) => index !== position)) fail('스트림 도구 인덱스가 누락되었습니다.');
    const tool_calls = indices.map(index => { const call = this.calls.get(index)!; return { id: call.id, type: call.type, function: { name: call.name, arguments: call.arguments } }; });
    return { model: this.model, usage: this.usage, choices: [{ finish_reason: this.finish, message: { role: 'assistant', content: this.text, ...(tool_calls.length ? { tool_calls } : {}) } }] };
  }
}

/** Incremental UTF-8/CRLF-safe SSE framing, bounded before JSON parsing. */
export class SSEDecoder {
  private decoder = new TextDecoder('utf-8', { fatal: true }); private buffer = ''; private data: string[] = []; private dataSize = 0; private bytes = 0; private events = 0;
  constructor(private accept: (data: string) => void) {}
  feed(bytes: Uint8Array) {
    this.bytes += bytes.byteLength;
    if (this.bytes > 8 * 1024 * 1024) throw new ProviderError('output-limit', '채팅 스트림 크기 제한을 초과했습니다.');
    try { this.buffer += this.decoder.decode(bytes, { stream: true }); } catch { fail('스트림 UTF-8이 잘못되었습니다.'); }
    this.lines(false);
  }
  end() {
    try { this.buffer += this.decoder.decode(); } catch { fail('스트림 UTF-8이 끊겼습니다.'); }
    this.lines(true);
    if (this.buffer || this.data.length) throw new ProviderError('incomplete-response', '스트림 이벤트가 완료 전에 끊겼습니다.');
  }
  private lines(final: boolean) {
    while (true) {
      const match = /[\r\n]/.exec(this.buffer); if (!match) break;
      const index = match.index;
      if (!final && this.buffer[index] === '\r' && index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, index), length = this.buffer[index] === '\r' && this.buffer[index + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(index + length);
      if (line.length > 512 * 1024) throw new ProviderError('output-limit', '스트림 이벤트 크기 제한을 초과했습니다.');
      if (!line) { if (this.data.length) { if (++this.events > 100000) fail('스트림 이벤트 개수가 너무 많습니다.'); this.accept(this.data.join('\n')); this.data = []; this.dataSize = 0; } }
      else if (line.startsWith('data:')) { const data = line.slice(5).replace(/^ /, ''); this.dataSize += data.length + 1; if (this.dataSize > 512 * 1024) throw new ProviderError('output-limit', '스트림 이벤트 크기 제한을 초과했습니다.'); this.data.push(data); }
    }
    if (this.buffer.length + this.dataSize > 512 * 1024) throw new ProviderError('output-limit', '스트림 이벤트 크기 제한을 초과했습니다.');
  }
}
