import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkspaceState } from '@workbench/contracts';
import { invokeChat, ProviderError, type ChatRequest } from '@workbench/providers';
import { initialState } from '../../../packages/core/src/engine.ts';
import { createSession, ensureStudio, sessionDetail, updateSession } from '../../../packages/core/src/studio.ts';
import { ProjectChat } from '../src/project-chat.ts';
import { ChatStreamProgress } from '../src/chat-stream-progress.ts';

class Store {
 current = initialState(); writes = 0;
 state() { return structuredClone(this.current); }
 studioMutation<T>(id: string, fn: (state: WorkspaceState) => T) { assert.equal(id, this.current.project.id); const next = structuredClone(this.current), result = fn(next); this.current = next; this.writes++; return result; }
}
function setup() { const store = new Store(), studio = ensureStudio(store.current); const profile = studio.profiles[0]; Object.assign(profile, { connectionId: 'openai', model: 'fake', effort: '', timeoutMs: 1000, maxAttempts: 1 }); const session = createSession(store.current, { profileId: profile.id }); return { store, session, project: store.current.project.id }; }

test('progress throttles burst writes, flushes cancelled tail and retains same message ID on completion', () => {
 const { store, session, project } = setup(), controller = new AbortController(), progress = new ChatStreamProgress(store, project, session.id, controller.signal);
 progress.update('a'); const id = store.current.studio!.messages[0].id;
 for (let count = 2; count <= 100; count++) progress.update('a'.repeat(count));
 assert.equal(store.writes, 1); assert.equal(store.current.studio!.messages.length, 1);
 const completed = store.studioMutation(project, state => progress.complete(state, { sessionId: session.id, role: 'assistant', content: 'a'.repeat(100), reportedModel: 'fake' }));
 assert.equal(completed.id, id); assert.equal(store.current.studio!.messages.length, 1); assert.equal(store.current.studio!.messages[0].streamStatus, 'completed');
 const cancelled = new ChatStreamProgress(store, project, session.id, controller.signal); cancelled.update('first'); cancelled.update('first tail'); controller.abort(); cancelled.stop('stopped');
 assert.equal(store.current.studio!.messages.at(-1)?.content, 'first tail'); assert.equal(store.current.studio!.messages.at(-1)?.streamStatus, 'stopped'); cancelled.update('first tail ignored'); assert.equal(store.current.studio!.messages.at(-1)?.content, 'first tail');
});

test('idle stream tail flushes once and terminal state clears pending timer', async () => {
 const { store, session, project } = setup(), progress = new ChatStreamProgress(store, project, session.id, new AbortController().signal);
 progress.update('first'); progress.update('first tail'); assert.equal(store.writes, 1);
 await new Promise(resolve => setTimeout(resolve, 1050)); assert.equal(store.writes, 2); assert.equal(store.current.studio!.messages[0].content, 'first tail');
 progress.update('first tail final'); progress.stop('failed'); const writes = store.writes; await new Promise(resolve => setTimeout(resolve, 1050)); assert.equal(store.writes, writes); assert.equal(store.current.studio!.messages[0].streamStatus, 'failed');
});

test('worker preserves stopped partial, ignores it in next history and executes no incomplete tools', async () => {
 const { store, session, project } = setup(); let announced!: () => void; const ready = new Promise<void>(resolve => { announced = resolve; }); let count = 0;
 const chat = new ProjectChat(store, { invoke: async request => { assert.equal(request.stream, true); count++; if (count === 1) { request.onText!('남겨진'); request.onText!('남겨진 응답'); announced(); return await new Promise((_resolve, reject) => request.signal!.addEventListener('abort', () => reject(new ProviderError('cancelled', 'stopped')), { once: true })); } assert.equal(request.messages.some(message => message.content.includes('남겨진 응답')), false); return { message: '완료', toolCalls: [] }; } });
 chat.start(project, session.id, { content: '첫 요청' }); await ready; chat.stop(project, session.id); await chat.drain();
 let detail = sessionDetail(store.current, session.id); assert.equal(detail.messages.at(-1)?.content, '남겨진 응답'); assert.equal(detail.messages.at(-1)?.streamStatus, 'stopped'); assert.equal(detail.toolCalls.length, 0);
 chat.start(project, session.id, { content: '계속' }); await chat.drain(); detail = sessionDetail(store.current, session.id); assert.equal(detail.session.status, 'idle'); assert.equal(detail.messages.at(-1)?.content, '완료'); assert.equal(detail.messages.at(-1)?.streamStatus, 'completed'); assert.equal(count, 2); await chat.close();
});

test('worker validates returned tools before replacing partial and restart marks partial stopped', async () => {
 const { store, session, project } = setup(); let requests = 0;
 const chat = new ProjectChat(store, { invoke: async (request: ChatRequest) => { requests++; request.onText!('부분 설명'); return { message: '부분 설명', toolCalls: [{ id: 'bad', name: 'draft_proposal', arguments: { title: 'bad', operations: 'malformed' } }] }; } });
 chat.start(project, session.id, { content: '요청' }); await chat.drain(); const detail = sessionDetail(store.current, session.id); assert.equal(detail.session.status, 'failed'); assert.equal(detail.messages.at(-1)?.streamStatus, 'failed'); assert.equal(detail.toolCalls.length, 0); assert.equal(detail.proposals.length, 0); assert.equal(requests, 1);
 updateSession(store.current, session.id, { status: 'running' }); store.current.studio!.messages.at(-1)!.streamStatus = 'streaming'; chat.recover(project); assert.equal(store.current.studio!.messages.at(-1)?.streamStatus, 'stopped'); await chat.close();
});

test('invalid final message does not leave partial in streaming state', async () => {
 const { store, session, project } = setup();
 const chat = new ProjectChat(store, { invoke: async request => { request.onText!('남을 텍스트'); return { message: '', toolCalls: [] }; } });
 chat.start(project, session.id, { content: '요청' }); await chat.drain();
 assert.equal(store.current.studio!.messages.at(-1)?.content, '남을 텍스트'); assert.equal(store.current.studio!.messages.at(-1)?.streamStatus, 'failed'); assert.equal(store.current.studio!.toolCalls.length, 0); await chat.close();
});

test('real SSE adapter through worker dispatches only fully validated final tool calls', async () => {
 const frame = (data: unknown) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
 const delta = (value: unknown, finish_reason: string | null = null) => ({ choices: [{ index: 0, delta: value, finish_reason }] });
 for (const malformed of [false, true]) {
  const { store, session, project } = setup(); let requests = 0;
  Object.assign(store.current.connections.find(connection => connection.id === 'openai')!, { envKey: undefined, baseUrl: 'http://127.0.0.1:9999/v1', allowUnauthenticated: true });
  const chat = new ProjectChat(store, { invoke: request => invokeChat(request, { fetch: (async () => {
   requests++;
   const events = requests === 1 ? [delta({ role: 'assistant', content: '조사 중', tool_calls: [{ index: 0, id: 'source1', type: 'function', function: { name: 'read_script', arguments: malformed ? '{"unitIds":' : '{"unitIds":[' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: malformed ? '' : '"S0-01"]}' } }] }), delta({}, 'tool_calls'), '[DONE]'] : [delta({ role: 'assistant', content: '최종 답변' }), delta({}, 'stop'), '[DONE]'];
   const bytes = new TextEncoder().encode(events.map(frame).join(''));
   return new Response(new ReadableStream({ start(stream) { for (let offset = 0; offset < bytes.length; offset += 7) stream.enqueue(bytes.slice(offset, offset + 7)); stream.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch }) });
  chat.start(project, session.id, { content: '원문 조사' }); await chat.drain(); const detail = sessionDetail(store.current, session.id);
  assert.equal(detail.toolCalls.length, malformed ? 0 : 1); assert.equal(detail.proposals.length, 0); assert.equal(requests, malformed ? 1 : 2);
  assert.equal(detail.messages.filter(message => message.role === 'assistant').length, malformed ? 1 : 2); assert.equal(detail.messages.at(-1)?.streamStatus, malformed ? 'failed' : 'completed');
  if (!malformed) { assert.equal(detail.toolCalls[0].status, 'completed'); assert.equal(detail.toolCalls[0].providerCallId, 'source1'); assert.equal(detail.messages.at(-1)?.content, '최종 답변'); }
  await chat.close();
 }
});
