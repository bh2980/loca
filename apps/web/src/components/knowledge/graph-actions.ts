import { freeName, useGraphHistory, type DeleteItem } from './graph-history';
import { pairKey } from '@tw/shared';
import type { Pair } from './pairs';
import { sent } from '@/lib/collections';
import type { Character, Relationship } from '@/lib/knowledge';

/**
 * What the relationship graph does, as the page's actions: draw a line (a relationship), add a
 * person, delete people or lines (a line takes its pair's relationship and speech rules), copy
 * people with the relationships among them. Every one is a step ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z replay.
 */
export function useRelationshipGraphActions({ projectId, characters, relationships, pairs, open }: { projectId: string; characters: Character[]; relationships: Relationship[]; pairs: { current: Pair[] }; open: (item: string) => void }) {
  // People, relationships and rules are collections the row feed keeps current: nothing to refetch.
  const { api, param, remove, restore, run, record, created, undo, redo } = useGraphHistory(projectId);
  /** Every name and alias in use: a new person takes one nobody has (the server refuses a second of the same). */
  const taken = () => new Set(characters.flatMap((character) => [character.name, ...character.aliases]).map((name) => name.toLowerCase()));

  return {
    /** Deletes people and lines (pair keys) at once. */
    remove: (target: { characterIds: string[]; pairIds: string[] }) =>
      run(async () => {
        const lines = pairs.current.filter((pair) => target.pairIds.includes(pair.key));
        const items: DeleteItem[] = [
          { kind: 'characters' as const, ids: target.characterIds },
          { kind: 'relationships' as const, ids: lines.flatMap((pair) => (pair.relationship ? [pair.relationship.id] : [])) },
          { kind: 'speechRules' as const, ids: lines.flatMap((pair) => pair.rules.map((rule) => rule.id)) },
        ].filter((item) => item.ids.length);
        if (!items.length) return;
        let token = await remove(items);
        record({ undo: () => restore(token), redo: async () => (token = await remove(items)) });
      }),
    /** A line drawn from one person to another: a relationship ("관계" until named), its pair opened to fill in. */
    connect: (fromId: string, toId: string) =>
      run(async () => {
        const from = characters.find((character) => character.id === fromId);
        const to = characters.find((character) => character.id === toId);
        if (!from || !to || fromId === toId) return;
        const key = pairKey(from.name, to.name);
        if (pairs.current.find((pair) => pair.key === key)?.relationship) return open(key);
        const row = await sent(projectId, api.relationships.$post({ param, json: { fromId, toId, kind: '관계' } }));
        record(created([{ kind: 'relationships', ids: [row.id] }]));
        open(key);
      }),
    /** 빈 곳 › 인물 추가: a new person; returns its id so the graph can put it where the menu opened. */
    addPerson: async () => {
      let id: string | undefined;
      await run(async () => {
        const row = await sent(projectId, api.characters.$post({ param, json: { name: freeName('새 인물', taken()) } }));
        id = row.id;
        record(created([{ kind: 'characters', ids: [row.id] }]));
        open(row.id);
      });
      return id;
    },
    /** Copies of people ("이름 (복사)") with the relationships among them; returns old id → new id. */
    duplicate: async (ids: string[]) => {
      const made = new Map<string, string>();
      await run(async () => {
        const names = taken();
        for (const original of characters.filter((character) => ids.includes(character.id))) {
          const name = freeName(`${original.name} (복사)`, names);
          names.add(name.toLowerCase());
          const { id: _id, name: _name, ...rest } = original;
          const row = await sent(projectId, api.characters.$post({ param, json: { ...rest, name, aliases: [] } as never }));
          made.set(original.id, row.id);
        }
        const lines: string[] = [];
        for (const relationship of relationships.filter((candidate) => made.has(candidate.fromId) && made.has(candidate.toId))) {
          const row = await sent(projectId, api.relationships.$post({ param, json: { fromId: made.get(relationship.fromId)!, toId: made.get(relationship.toId)!, kind: relationship.kind, description: relationship.description, mutual: relationship.mutual, changes: relationship.changes as never } }));
          lines.push(row.id);
        }
        // Deleting the copied people takes their relationships with them (and brings them back).
        if (made.size) record(created([{ kind: 'characters', ids: [...made.values()] }]));
      });
      return made;
    },
    undo,
    redo,
  };
}

export type RelationshipGraphActions = ReturnType<typeof useRelationshipGraphActions>;
