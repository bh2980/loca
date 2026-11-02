import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_RULES, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from './index.ts';

const node = (id: string, type: string, config: object = {}) => ({ id, type, position: { x: 0, y: 0 }, config });
const edge = (source: string, sourceHandle: string, target: string) => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target });

describe('0121: 재요청 nodes become retry rules', () => {
  it('turns each chain into its AI node\'s rules and leads the 오류 exit where the chain ended', () => {
    const db = openDatabase(':memory:');
    const definition = {
      nodes: [
        node('entry', 'entry'),
        node('translate', 'ai'),
        node('translate-resend', 'retry', { kinds: ['cut-off', 'too-long', 'missing', 'invalid-output', 'timeout'], scale: 0.5, maxTimes: 2 }),
        node('translate-wait', 'retry', { kinds: ['rate-limit', 'network'], scale: 1, wait: 60, maxTimes: 3 }),
        node('failed', 'function', { fn: 'setStatus', params: {} }),
        node('review', 'ai'),
        node('review-resend', 'retry', { kinds: ['cut-off'], scale: 0.25, maxTimes: 1 }),
        node('plain', 'ai'),
      ],
      edges: [
        edge('entry', 'out', 'translate'),
        edge('translate', 'out', 'review'),
        edge('translate', 'error', 'translate-resend'),
        edge('translate-resend', 'retry', 'translate'),
        edge('translate-resend', 'error', 'translate-wait'),
        edge('translate-wait', 'retry', 'translate'),
        edge('translate-wait', 'error', 'failed'),
        edge('review', 'out', 'plain'),
        edge('review', 'error', 'review-resend'),
        edge('review-resend', 'retry', 'review'),
      ],
      settings: { maxVisitsPerNode: 8, maxConsecutiveFailures: 3 },
    };
    const row = db.$client.prepare('select retry_rules(?) as value').get(JSON.stringify(definition)) as { value: string };
    const after = workflowDefinitionSchema.parse(JSON.parse(row.value));
    const config = (id: string) => (after.nodes.find((item) => item.id === id) as { config: { retries: unknown } }).config.retries;
    expect(after.nodes.map((item) => item.id)).toEqual(['entry', 'translate', 'failed', 'review', 'plain']);
    // The template's two nodes are the workflow's default rules; another chain stays the node's own; no chain, no retries.
    expect(config('translate')).toBeNull();
    expect(config('review')).toEqual([{ kinds: ['cut-off'], scale: 0.25, maxTimes: 1, wait: 0, model: null }]);
    expect(config('plain')).toEqual([]);
    expect(after.settings.retries).toEqual(DEFAULT_RETRY_RULES);
    expect(after.edges.map((item) => item.id)).toEqual(['entry-out-translate', 'translate-out-review', 'review-out-plain', 'translate-error-failed']);

    const origin = (nodeId: string) => (db.$client.prepare('select retry_node_origin(?, ?) as value').get(JSON.stringify(definition), nodeId) as { value: string }).value;
    expect(origin('translate-wait')).toBe('translate');
    expect(origin('review')).toBe('review');
  });
});
