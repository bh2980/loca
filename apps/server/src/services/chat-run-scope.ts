import { and, eq } from 'drizzle-orm';
import { runKindsLeft, workflowInput, type RunScope, type Subject } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { lineConditions, resolveLineFilter } from './line-filter.ts';
import { askedScope } from './run-plan.ts';

export interface ScopePick {
  kind: string;
  id: string;
}

export type ChatRunScope = { ok: true; input: Subject; scope: RunScope; workflowName: string } | { ok: false; error: string };

/**
 * What the picks of a /workflow run mean as a run scope: scenes, tags, statuses and lines become the line filter
 * every surface uses (resolved by the same resolver, so a pick that is gone is refused by name), a person adds the
 * lines they speak (under every spelling), terms are the terms. Picks the workflow cannot take (scenes for a terms
 * workflow) or that would silently narrow each other (scenes and lines together) are refused with the reason.
 */
export function chatRunScope(db: Db, projectId: string, workflowId: string, picks: ScopePick[]): ChatRunScope {
  const workflow = db.select().from(s.workflows).where(and(eq(s.workflows.id, workflowId), eq(s.workflows.projectId, projectId))).get();
  if (!workflow) return { ok: false, error: '워크플로를 찾을 수 없습니다.' };
  const input = workflowInput(workflow.definition);
  if (!picks.length) return { ok: false, error: '실행할 대상을 고르세요.' };
  const allowed = runKindsLeft(input, []) as readonly string[];
  const foreign = picks.find((pick) => !allowed.includes(pick.kind));
  if (foreign) return { ok: false, error: `‘${workflow.name}’은 ${allowed.join('·')}만 대상으로 받습니다. ${foreign.kind}은 고를 수 없습니다.` };
  // Each pick must still be the one in the list: a kind left after the earlier picks.
  for (let at = 1; at < picks.length; at++) {
    if (!(runKindsLeft(input, picks.slice(0, at)) as readonly string[]).includes(picks[at].kind)) return { ok: false, error: '장면과 대사(인물)는 함께 고를 수 없습니다. 하나만 고르세요.' };
  }
  const ids = (kind: string) => [...new Set(picks.filter((pick) => pick.kind === kind).map((pick) => pick.id))];
  /** The picks as the scope of each input: terms by id; picked lines and the lines of picked people as one list of lines. */
  const scopes: Record<Subject, () => ChatRunScope> = {
    terms: () => {
      const resolved = askedScope(db, projectId, input, { terms: { terms: ids('용어') } });
      return resolved.ok ? { ok: true, input, scope: resolved.scope, workflowName: workflow.name } : resolved;
    },
    lines: () => {
      const lines = new Set(ids('대사'));
      const people = ids('인물');
      if (people.length) {
        const names = db.select({ name: s.characters.name }).from(s.characters).where(and(eq(s.characters.projectId, projectId), inList(s.characters.id, people))).all().map((person) => person.name);
        const spoken = names.length ? lineConditions(projectId, resolveLineFilter(db, projectId, { speakers: names }).filter) : null;
        if (spoken) for (const row of db.select({ id: s.units.id }).from(s.units).where(and(...spoken)).all()) lines.add(row.id);
      }
      const some = (list: string[]) => (list.length ? list : undefined);
      const resolved = askedScope(db, projectId, input, { filter: { groups: some(ids('장면')), tags: some(ids('태그')), statuses: some(ids('상태')), ids: some([...lines]) } });
      if (!resolved.ok) return resolved;
      // A person who has no line is a scope with nothing in it, not "every line".
      const scope: RunScope = people.length && !lines.size ? { ...resolved.scope, filter: { ...resolved.scope.filter, nothing: true } } : resolved.scope;
      return { ok: true, input, scope, workflowName: workflow.name };
    },
  };
  return scopes[input]();
}
