import { useSyncExternalStore } from 'react';
import { stored, STORED } from './storage';

/** Chat dock visibility is a per-browser preference, kept outside the URL so it never adds history entries. */
const openSlot = stored(STORED.chatOpen);
type SessionListener = (projectId: string, sessionId: string) => void;
const sessionListeners = new Set<SessionListener>();
type PrefillListener = (projectId: string, text: string) => void;
const prefillListeners = new Set<PrefillListener>();
/** A prefill nobody has taken yet (the panel was not listening); the panel takes it when it mounts or on its next look. */
let pendingPrefill: { projectId: string; text: string } | null = null;

export const chatDock = {
  subscribe: (listener: () => void) => openSlot.subscribe(listener),
  onOpenSession(listener: SessionListener) {
    sessionListeners.add(listener);
    return () => {
      sessionListeners.delete(listener);
    };
  },
  /** The chat input's draft is set to `text` (the project's chat panel listens). */
  onPrefill(listener: PrefillListener) {
    prefillListeners.add(listener);
    return () => {
      prefillListeners.delete(listener);
    };
  },
  /** The prefill waiting for this project's panel, if any (it is forgotten once taken). */
  takePrefill(projectId: string) {
    if (pendingPrefill?.projectId !== projectId) return null;
    const { text } = pendingPrefill;
    pendingPrefill = null;
    return text;
  },
  /** Opens the chat dock with `text` in the input box (not sent: the person finishes and sends it). */
  prefill(projectId: string, text: string) {
    pendingPrefill = { projectId, text };
    chatDock.set(true);
    prefillListeners.forEach((listener) => listener(projectId, text));
  },
  get: () => openSlot.read(),
  set: (next: boolean) => openSlot.write(next),
  toggle: () => chatDock.set(!chatDock.get()),
  openSession(projectId: string, sessionId: string) {
    rememberChatSession(projectId, sessionId);
    chatDock.set(true);
    sessionListeners.forEach((listener) => listener(projectId, sessionId));
  },
};

export const useChatDockOpen = () => useSyncExternalStore(chatDock.subscribe, chatDock.get);

/**
 * The conversation the chat panel has open in a project: this tab's own, else the one this browser last had open
 * (where a new tab starts).
 */
export const rememberedChatSession = (projectId: string) => stored(STORED.chatSession, projectId).read() ?? stored(STORED.chatSessionLast, projectId).read();
/** Remembers the open conversation for this tab and as the browser's last; null forgets it (it was deleted). */
export function rememberChatSession(projectId: string, sessionId: string | null) {
  stored(STORED.chatSession, projectId).write(sessionId);
  stored(STORED.chatSessionLast, projectId).write(sessionId);
}
