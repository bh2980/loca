import { describe, expect, it } from 'vitest';
import * as s from './schema.ts';
import { openDatabase } from './index.ts';
import { perDatabase } from './per-database.ts';
import { eventsOf } from '../events.ts';
import type { ChangeEvent } from '@loca/shared';

describe('state kept per open database', () => {
  it('is one for a database, its connection and its transactions, and another for another database', () => {
    const made: unknown[] = [];
    const state = perDatabase((sqlite) => {
      made.push(sqlite);
      return new Map<string, number>();
    });
    const [first, second] = [openDatabase(':memory:'), openDatabase(':memory:')];
    state(first).set('p', 1);
    expect(state(first.$client).get('p')).toBe(1);
    first.transaction((tx) => expect(state(tx).get('p')).toBe(1));
    expect(state(second).get('p')).toBeUndefined();
    expect(made).toEqual([first.$client, second.$client]);
    expect(() => state({})).toThrow('not a database handle');
  });

  it('gives each database its own change events: one database’s writes are not heard on another’s', () => {
    const [first, second] = [openDatabase(':memory:'), openDatabase(':memory:')];
    const heard: ChangeEvent[] = [];
    eventsOf(first).on('change', (event) => heard.push(event));
    second.insert(s.projects).values({ id: 'p', name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).run();
    eventsOf(second).flush();
    eventsOf(first).flush();
    expect(heard).toEqual([]);
    first.insert(s.projects).values({ id: 'p', name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).run();
    eventsOf(first).flush();
    expect(heard.map((event) => event.topics)).toEqual([expect.arrayContaining(['projects'])]);
  });
});
