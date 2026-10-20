import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { pairKey, type Pair } from './pairs';

type Item = { kind: 'characters' | 'relationships' | 'speechRules'; ids: string[] };
/** One undoable change: both directions go through the server (a delete keeps what it removed under a token). */
interface Step {
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
}

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

/** A name no person has yet: "새 인물", "새 인물 2"… */
const freeName = (base: string, taken: Set<string>) => {
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
};

/**
 * What the relationship graph does, as the page's actions: draw a line (a relationship), add a
 * person, delete people or lines (a line takes its pair's relationship and speech rules), copy
 * people with the relationships among them. Every one is a step ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z replay.
 */
export function useRelationshipGraphActions({ projectId, characters, relationships, pairs, open }: { projectId: string; characters: Character[]; relationships: Relationship[]; pairs: { current: Pair[] }; open: (item: string) => void }) {
  const queryClient = useQueryClient();
  const api = client.projects[':projectId'];
  const param = { projectId };
  const history = useRef<{ past: Step[]; future: Step[] }>({ past: [], future: [] });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: q.characters(projectId).queryKey });
    void queryClient.invalidateQueries({ queryKey: q.speechRules(projectId).queryKey });
  };
  const remove = async (items: Item[]) => (await unwrap(api['knowledge-delete'].$post({ param, json: { items } }))).token;
  const restore = (token: string) => unwrap(api['knowledge-restore'].$post({ param, json: { token } }));
  const run = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      refresh();
    }
  };
  /** Something just created: undo deletes it (keeping it), redo puts it back. */
  const created = (items: Item[]): Step => {
    let token = '';
    return { undo: async () => (token = await remove(items)), redo: () => restore(token) };
  };
  const record = (step: Step) => {
    history.current.past.push(step);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
  };

  return {
    /** Deletes people and lines (pair keys) at once. */
    remove: (target: { characterIds: string[]; pairIds: string[] }) =>
      run(async () => {
        const lines = pairs.current.filter((pair) => target.pairIds.includes(pair.key));
        const items: Item[] = [
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
    undo: () =>
      run(async () => {
        const step = history.current.past.pop();
        if (!step) return;
        await step.undo();
        history.current.future.push(step);
      }),
    redo: () =>
      run(async () => {
        const step = history.current.future.pop();
        if (!step) return;
        await step.redo();
        history.current.past.push(step);
      }),
  };
}

export type RelationshipGraphActions = ReturnType<typeof useRelationshipGraphActions>;
