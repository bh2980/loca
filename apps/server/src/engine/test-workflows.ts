import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/**
 * Tests that only need a plain "translate and save" flow: the project's 번역 workflow cut down to
 * entry → AI 번역 → 번역 저장 (the AI node keeps the workflow's retry rules).
 */
export function translateOnlyWorkflow(db: Db, projectId: string) {
  const row = db.select().from(s.workflows).where(and(eq(s.workflows.projectId, projectId), eq(s.workflows.name, '번역'))).get()!;
  const keep = new Set(['entry', 'translate', 'save']);
  const { definition } = row;
  // Their exit actions go too (the AI's 오류 exit would set 검토 필요): a failed line ends failed.
  return { ...row, definition: { ...definition, nodes: definition.nodes.filter((node) => keep.has(node.id)).map(({ exits: _exits, ...node }) => node), edges: definition.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)) } };
}

const DROPPED = new Set(['terms', 'save-terms', 'speech', 'speech-sure', 'speech-ok', 'has-rule']);
/**
 * The 번역 workflow without its closing 용어 추출 branch and its 말투 판정 (형식 검사 goes straight to AI
 * 검수): tests that count the translate/review calls of a line.
 */
export function withoutTerms<T extends { nodes: { id: string }[]; edges: { id?: string; source: string; sourceHandle?: string; target: string }[] }>(definition: T): T {
  const edges = definition.edges.filter((edge) => !DROPPED.has(edge.source) && !DROPPED.has(edge.target));
  const judged = definition.nodes.some((node) => node.id === 'speech');
  return {
    ...definition,
    nodes: definition.nodes.filter((node) => !DROPPED.has(node.id)),
    edges: [
      ...edges,
      ...(judged ? [{ id: 'glossary-pass-review', source: 'glossary', sourceHandle: 'pass', target: 'review' } as T['edges'][number]] : []),
    ],
  };
}
