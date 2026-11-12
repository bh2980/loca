import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { badRequest, conflict, found } from '../refusal.ts';

function workflowFor(db: Db, projectId: string, id: string) {
  return found(db.select().from(s.workflows).where(and(eq(s.workflows.id, id), eq(s.workflows.projectId, projectId))).get(), '워크플로');
}

function requireIdle(db: Db, workflowId: string) {
  const active = db.select({ id: s.runs.id }).from(s.runs).where(and(eq(s.runs.workflowId, workflowId), inArray(s.runs.status, ['preparing', 'running', 'paused']))).limit(1).get();
  if (active) badRequest('실행 중인 워크플로는 바꿀 수 없습니다. 실행이 끝나거나 멈춘 뒤 다시 시도하세요.');
}

export function saveWorkflow(db: Db, projectId: string, input: { id?: string; name: string; description: string; definition: WorkflowDefinition; version?: number }) {
  if (input.id) {
    const current = workflowFor(db, projectId, input.id);
    if (input.version !== undefined && current.version !== input.version) conflict('다른 곳에서 먼저 저장했습니다. 새로고침 후 다시 저장하세요.');
    requireIdle(db, current.id);
    const row = db.update(s.workflows).set({ name: input.name, description: input.description, definition: input.definition, version: current.version + 1 }).where(and(eq(s.workflows.id, current.id), eq(s.workflows.projectId, projectId))).returning().get();
    return row!;
  }
  const row = db.insert(s.workflows).values({ projectId, name: input.name, description: input.description, definition: input.definition }).returning().get();
  return row;
}

/** A workflow name the project has not used: `base`, then `base 2`, `3`… */
export function freeWorkflowName(db: Db, projectId: string, base: string): string {
  const taken = new Set(db.select({ name: s.workflows.name }).from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().map((row) => row.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * A copy of a workflow: its description and definition as they are, under a name of its own ("<이름> (복사본)" unless
 * one is given), as a new workflow at version 1 with no runs. One insert, so there is never a copy without its definition.
 */
export function duplicateWorkflow(db: Db, projectId: string, id: string, name?: string) {
  const source = workflowFor(db, projectId, id);
  return db.insert(s.workflows).values({ projectId, name: name?.trim() || freeWorkflowName(db, projectId, `${source.name} (복사본)`), description: source.description, definition: source.definition }).returning().get();
}

/** The project's other workflows with a 워크플로 호출 node that picks workflow `id`, by name. */
export function workflowCallers(db: Db, projectId: string, id: string): { id: string; name: string }[] {
  return db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).orderBy(asc(s.workflows.name)).all()
    .filter((row) => row.id !== id && row.definition.nodes.some((node) => node.type === 'call' && node.config.workflowId === id))
    .map((row) => ({ id: row.id, name: row.name }));
}

export function deleteWorkflow(db: Db, projectId: string, id: string) {
  const current = workflowFor(db, projectId, id);
  requireIdle(db, current.id);
  const callers = workflowCallers(db, projectId, current.id);
  if (callers.length) badRequest(`이 워크플로를 부르는 곳이 있습니다: ${callers.slice(0, 5).map((caller) => caller.name).join(', ')}${callers.length > 5 ? ` 외 ${callers.length - 5}곳` : ''}. 그곳에서 호출을 지운 뒤 지우세요.`);
  db.delete(s.workflows).where(and(eq(s.workflows.id, current.id), eq(s.workflows.projectId, projectId))).run();
  return { ok: true as const };
}
