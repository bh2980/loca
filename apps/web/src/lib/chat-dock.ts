import { useSyncExternalStore } from 'react';

/** Chat dock visibility is a per-browser preference, kept outside the URL so it never adds history entries. */
const KEY = 'tw.chat.open';
let open = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();
type SessionListener = (projectId: string, sessionId: string) => void;
const sessionListeners = new Set<SessionListener>();
type PrefillListener = (projectId: string, text: string) => void;
const prefillListeners = new Set<PrefillListener>();
/** A prefill nobody has taken yet (the panel was not listening); the panel takes it when it mounts or on its next look. */
let pendingPrefill: { projectId: string; text: string } | null = null;

export const chatDock = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
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
  get: () => open,
  set(next: boolean) {
    open = next;
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
    listeners.forEach((listener) => listener());
  },
  toggle: () => chatDock.set(!open),
  openSession(projectId: string, sessionId: string) {
    try {
      sessionStorage.setItem(`tw.chat.session.${projectId}`, sessionId);
      localStorage.setItem(`tw.chat.session.${projectId}`, sessionId);
    } catch {
      /* private mode */
    }
    chatDock.set(true);
    sessionListeners.forEach((listener) => listener(projectId, sessionId));
  },
};

export const useChatDockOpen = () => useSyncExternalStore(chatDock.subscribe, chatDock.get);
