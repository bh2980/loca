import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CONNECTION_KIND_INFO, CONNECTION_KINDS, type Capability } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { liveChoice, snapshotChoice } from './model-target.ts';
import { memoryStore } from './secrets.ts';

describe('model choices', () => {
  it('freeze the picked target with the connection\'s output limit for that model', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'a', kind: 'openai', name: 'A', modelLimits: { ma: { maxOutput: 4000, by: 'api' } } }).run();
    const snapshot = snapshotChoice(db, { connectionId: 'a', model: 'ma', effort: 'high' })!;
    expect(snapshot).toMatchObject({ label: 'A · ma · high', maxOutputTokens: 4000, target: { connectionId: 'a', name: 'A', kind: 'openai', model: 'ma', effort: 'high' } });
    expect(snapshot).not.toHaveProperty('route');
    expect(snapshot).not.toHaveProperty('maxAttempts');
    // A model whose output limit is unknown gets no cap.
    expect(snapshotChoice(db, { connectionId: 'a', model: 'unlisted' })!.maxOutputTokens).toBeUndefined();
    expect(snapshotChoice(db, { connectionId: 'gone', model: 'x' })).toBeUndefined();
  });

  it('refuse a connection that cannot do what the place needs', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'j', kind: 'systemone', name: 'Judge' }).run();
    expect(() => liveChoice(db, { connectionId: 'j', model: 'm' }, memoryStore(), 'chat')).toThrow('채팅에 쓸 수 없습니다');
    expect(() => liveChoice(db, { connectionId: 'x', model: 'm' }, memoryStore(), 'generate')).toThrow('AI 연결이 없습니다');
  });

  it('ask the capability, not the kind: each place takes exactly the kinds that can do what it needs', () => {
    const db = openDatabase(':memory:');
    for (const kind of CONNECTION_KINDS) db.insert(s.connections).values({ id: kind, kind, name: kind }).run();
    const takes = (need: Capability) => CONNECTION_KINDS.filter((kind) => {
      try {
        return Boolean(liveChoice(db, { connectionId: kind, model: 'm' }, memoryStore(), need));
      } catch {
        return false;
      }
    });
    for (const need of CAPABILITIES) expect(takes(need), need).toEqual(CONNECTION_KINDS.filter((kind) => CONNECTION_KIND_INFO[kind].capabilities.includes(need)));
    // The editor's autocomplete follows typing: only a kind that completes plain text fast enough is taken (a CLI is refused, saying so).
    expect(takes('complete')).toEqual(['openai']);
    expect(() => liveChoice(db, { connectionId: 'claude', model: 'm' }, memoryStore(), 'complete')).toThrow('편집기 자동완성은 API 연결');
    // A judgment connection does not write, and a writing one is not a judgment connection.
    expect(() => liveChoice(db, { connectionId: 'systemone', model: 'm' }, memoryStore(), 'generate')).toThrow('글을 쓰지 못해');
    expect(() => liveChoice(db, { connectionId: 'openai', model: 'm' }, memoryStore(), 'judge')).toThrow('판정 연결이 아닙니다');
  });
});
