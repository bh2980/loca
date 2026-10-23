import { and, eq } from 'drizzle-orm';
import { runKindsLeft, workflowInput } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

export interface ScopePick {
  kind: string;
  id: string;
}

export type ChatRunScope = { ok: true; input: 'lines' | 'terms'; scope: s.RunScope; workflowName: string } | { ok: false; error: string };

/**
 * What the picks of a /workflow run mean as the run scope the run dialog sends: scenes → groupIds,
 * lines → unitIds, a person → the lines they speak (by name or alias), tags → tagIds, statuses →
 * statusIds, terms → termIds. Picks the workflow cannot take (scenes for a terms workflow) or that
 * would silently narrow each other (scenes and lines together) are refused with the reason.
 */
export function chatRunScope(db: Db, projectId: string, workflowId: string, picks: ScopePick[]): ChatRunScope {
  const workflow = db.select().from(s.workflows).where(and(eq(s.workflows.id, workflowId), eq(s.workflows.projectId, projectId))).get();
  if (!workflow) return { ok: false, error: '워크플로를 찾을 수 없습니다.' };
  const input = workflowInput(workflow.definition);
  if (!picks.length) return { ok: false, error: '실행할 대상을 고르세요.' };
  const allowed = runKindsLeft(input, []) as readonly string[];
  const foreign = picks.find((pick) => !allowed.includes(pick.kind));
  if (foreign) return { ok: false, error: `‘${workflow.name}’은 ${input === 'terms' ? '용어' : '장면·대사·태그·상태·인물'}만 대상으로 받습니다. ${foreign.kind}은 고를 수 없습니다.` };
  // Each pick must still be the one in the list: a kind left after the earlier picks.
  for (let at = 1; at < picks.length; at++) {
    if (!(runKindsLeft(input, picks.slice(0, at)) as readonly string[]).includes(picks[at].kind)) return { ok: false, error: '장면과 대사(인물)는 함께 고를 수 없습니다. 하나만 고르세요.' };
  }
  const ids = (kind: string) => [...new Set(picks.filter((pick) => pick.kind === kind).map((pick) => pick.id))];
  const scope: s.RunScope = {};
  if (ids('장면').length) scope.groupIds = ids('장면');
  if (ids('용어').length) scope.termIds = ids('용어');
  if (ids('태그').length) scope.tagIds = ids('태그');
  if (ids('상태').length) scope.statusIds = ids('상태');
  const lines = new Set(ids('대사'));
  const people = ids('인물');
  if (people.length) {
    const names = new Set<string>();
    for (const person of db.select({ name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(and(eq(s.characters.projectId, projectId), inList(s.characters.id, people))).all()) {
      names.add(person.name);
      for (const alias of person.aliases) names.add(alias);
    }
    if (names.size) for (const row of db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), inList(s.units.speaker, [...names]))).all()) lines.add(row.id);
    // A person who has no line is a scope with nothing in it, not "every line".
    if (!lines.size) lines.add('__none__');
  }
  if (lines.size) scope.unitIds = [...lines];
  return { ok: true, input, scope, workflowName: workflow.name };
}
