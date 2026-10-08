import { useSyncExternalStore } from 'react';
import { chatDock } from './chat-dock';

/**
 * AI buttons across the app don't call models themselves: they hand a request to the
 * project agent in the chat dock, so every result arrives as the same accept/reject card
 * and the user can keep talking about it. `send: false` only fills the input box.
 */
export interface AgentRequest {
  id: number;
  text: string;
  send: boolean;
}

let pending: AgentRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const agentRequests = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => pending,
  take() {
    const request = pending;
    pending = null;
    emit();
    return request;
  },
};

export function askAgent(text: string, options: { send?: boolean } = {}) {
  pending = { id: Date.now(), text, send: options.send ?? true };
  chatDock.set(true);
  emit();
}

export const usePendingAgentRequest = () => useSyncExternalStore(agentRequests.subscribe, agentRequests.get);
