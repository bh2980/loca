import type { ChatMessage, WorkspaceState } from '@workbench/contracts';
import { appendChatMessage, ensureStudio } from '../../../packages/core/src/studio.ts';
import { ProviderError } from '@workbench/providers';

type MessageInput = Parameters<typeof appendChatMessage>[1];
export interface ProgressStore { state(): WorkspaceState; studioMutation<T>(projectId: string, fn: (state: WorkspaceState) => T): T }
const SAVE_INTERVAL = 1000;
/** A single provider attempt owns one partial record. First text immediately, then at most one write/second. */
export class ChatStreamProgress {
  private text = ''; private saved = ''; private id?: string; private closed = false;
  private failure?: unknown;
  private lastWrite = 0; private timer?: ReturnType<typeof setTimeout>;
  constructor(private store: ProgressStore, private projectId: string, private sessionId: string, private signal: AbortSignal) {}
  update = (text: string) => {
    if (this.closed || this.signal.aborted) return;
    if (this.failure) throw this.failure;
    // The adapter owns append-only assembly; checking the entire prefix per token is quadratic.
    if (typeof text !== 'string' || text.length > 100000 || text.length < this.text.length) throw new ProviderError('invalid-stream', '채팅 진행 텍스트가 잘못되었습니다.');
    this.text = text;
    if (Date.now() - this.lastWrite >= SAVE_INTERVAL) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.closed && !this.signal.aborted) try { this.flush(); } catch (error) { this.failure = error; }
    }, Math.max(1, SAVE_INTERVAL - (Date.now() - this.lastWrite)));
  };
  private flush() {
    if (this.text === this.saved || this.store.state().project.id !== this.projectId) return;
    this.store.studioMutation(this.projectId, state => {
      const existing = this.id && ensureStudio(state).messages.find(message => message.id === this.id && message.sessionId === this.sessionId);
      if (existing) existing.content = this.text;
      else this.id = appendChatMessage(state, { sessionId: this.sessionId, role: 'assistant', content: this.text, streamStatus: 'streaming' }).id;
    });
    this.saved = this.text; this.lastWrite = Date.now();
  }
  stop(status: 'stopped' | 'failed') {
    if (this.closed) return;
    this.clear(); this.closed = true;
    if (!this.text || this.store.state().project.id !== this.projectId) return;
    this.store.studioMutation(this.projectId, state => {
      const message = ensureStudio(state).messages.find(message => message.id === this.id && message.sessionId === this.sessionId);
      if (message) { message.content = this.text; message.streamStatus = status; }
      else this.id = appendChatMessage(state, { sessionId: this.sessionId, role: 'assistant', content: this.text, streamStatus: status }).id;
    });
  }
  complete(state: WorkspaceState, input: MessageInput): ChatMessage {
    this.clear();
    if (this.failure) throw this.failure;
    // The normal append path validates and whitelists metadata before replacing the partial.
    const result = appendChatMessage(state, { ...input, streamStatus: 'completed' });
    this.closed = true;
    const studio = ensureStudio(state), existing = this.id && studio.messages.find(message => message.id === this.id && message.sessionId === this.sessionId);
    if (!existing) return result;
    const id = existing.id, createdAt = existing.createdAt;
    Object.assign(existing, result, { id, createdAt });
    studio.messages = studio.messages.filter(message => message.id !== result.id);
    return structuredClone(existing);
  }
  private clear() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
}
