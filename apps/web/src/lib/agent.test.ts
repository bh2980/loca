import { describe, expect, it, vi } from 'vitest';

vi.mock('./chat-dock', () => ({ chatDock: { set: () => {} } }));
const { agentRequests, askAgent } = await import('./agent');

describe('requests from AI buttons (#54: one was sent twice)', () => {
  it('is taken once: a second take finds nothing to send', () => {
    askAgent('이 노드를 다듬어줘');
    expect(agentRequests.take()?.text).toBe('이 노드를 다듬어줘');
    expect(agentRequests.take()).toBeNull();
    expect(agentRequests.get()).toBeNull();
  });
});
