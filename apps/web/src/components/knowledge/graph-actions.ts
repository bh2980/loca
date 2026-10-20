import { useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { freeName, useGraphHistory, type DeleteItem } from './graph-history';
import { pairKey, type Pair } from './pairs';

interface Character {
  id: string;
  name: string;
  aliases: string[];
  profile: string;
  speech: string;
  style: Record<string, unknown>;
  gender: string;
  ageBand: string;
  role: string;
  player: boolean;
}
interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  description: string;
  mutual: boolean;
  changes: unknown[];
}

/**
 * What the relationship graph does, as the page's actions: draw a line (a relationship), add a
 * person, delete people or lines (a line takes its pair's relationship and speech rules), copy
 * people with the relationships among them. Every one is a step ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z replay.
 */
export function useRelationshipGraphActions({ projectId, characters, relationships, pairs, open }: { projectId: string; characters: Character[]; relationships: Relationship[]; pairs: { current: Pair[] }; open: (item: string) => void }) {
  const queryClient = useQueryClient();
  const { api, param, remove, restore, run, record, created, undo, redo } = useGraphHistory(projectId, () => {
    void queryClient.invalidateQueries({ queryKey: q.characters(projectId).queryKey });
    void queryClient.invalidateQueries({ queryKey: q.speechRules(projectId).queryKey });
  });

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
        const row = await unwrap(api.relationships.$post({ param, json: { fromId, toId, kind: '관계' } }));
        record(created([{ kind: 'relationships', ids: [row.id] }]));
        open(key);
      }),
    /** 빈 곳 › 인물 추가: a new person; returns its id so the graph can put it where the menu opened. */
    addPerson: async () => {
      let id: string | undefined;
      await run(async () => {
        const row = await unwrap(api.characters.$post({ param, json: { name: freeName('새 인물', new Set(characters.map((character) => character.name.toLowerCase()))) } }));
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
        const taken = new Set(characters.map((character) => character.name.toLowerCase()));
        for (const original of characters.filter((character) => ids.includes(character.id))) {
          const name = freeName(`${original.name} (복사)`, taken);
          taken.add(name.toLowerCase());
          const { id: _id, name: _name, ...rest } = original;
          const row = await unwrap(api.characters.$post({ param, json: { ...rest, name, aliases: [] } as never }));
          made.set(original.id, row.id);
        }
        const lines: string[] = [];
        for (const relationship of relationships.filter((candidate) => made.has(candidate.fromId) && made.has(candidate.toId))) {
          const row = await unwrap(api.relationships.$post({ param, json: { fromId: made.get(relationship.fromId)!, toId: made.get(relationship.toId)!, kind: relationship.kind, description: relationship.description, mutual: relationship.mutual, changes: relationship.changes as never } }));
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
