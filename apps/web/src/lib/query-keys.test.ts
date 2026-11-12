import { describe, expect, it } from 'vitest';
import { TOPICS, withImplied, type Topic } from '@tw/shared';
import { idsFingerprint, key, OWN_FAMILIES, ownKey } from './query-keys';

describe('query keys', () => {
  it('a key starts with its topic and its name, then what it was asked with', () => {
    expect(key('units', 'ids', 'p1', { q: 'a' }, null)).toEqual(['units', 'ids', 'p1', { q: 'a' }, null]);
  });

  it('a family outside the topics is never named like a topic, and says what it follows', () => {
    for (const family of Object.keys(OWN_FAMILIES)) expect(TOPICS as readonly string[]).not.toContain(family);
    expect(ownKey('line-surroundings', 'u1')).toEqual({ queryKey: ['line-surroundings', 'u1'], meta: { follows: ['knowledge', 'graph'] } });
    expect(ownKey('run-start', 'r1', 'running|').meta.follows).toEqual([]);
  });

  it('a list of ids is told apart by its fingerprint: order and content both count', () => {
    expect(idsFingerprint(['a', 'b'])).toBe(idsFingerprint(['a', 'b']));
    expect(idsFingerprint(['a', 'b'])).not.toBe(idsFingerprint(['b', 'a']));
    expect(idsFingerprint(['ab'])).not.toBe(idsFingerprint(['a', 'b']));
    expect(idsFingerprint([])).toBe('0:' + (0x811c9dc5).toString(36));
  });
});

describe('what a keyed question reads beyond its topic (IMPLIES)', () => {
  const reaches = (from: Topic, to: Topic) => withImplied([from]).has(to);

  it("an AI node's request preview (workflows) is asked again when anything a line's request reads changes", () => {
    for (const topic of ['workflows', 'units', 'knowledge', 'terms', 'statuses', 'projects', 'connections', 'graph'] as const) expect(reaches(topic, 'workflows'), topic).toBe(true);
  });

  it('the questions keyed under units are asked again when what the line filter and the preflight read changes', () => {
    for (const topic of ['graph', 'knowledge', 'terms', 'workflows', 'projects', 'statuses', 'connections'] as const) expect(reaches(topic, 'units'), topic).toBe(true);
  });

  it("a run's continue preflight (runs) follows the calls the run made", () => expect(reaches('calls', 'runs')).toBe(true));
});
