import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/**
 * Tests that only need a plain "translate and save" flow: the project's 번역 workflow cut down to
 * entry → AI 번역 (→ 재요청) → 번역 저장.
 */
export function translateOnlyWorkflow(db: Db, projectId: string) {
  const row = db.select().from(s.workflows).where(and(eq(s.workflows.projectId, projectId), eq(s.workflows.name, '번역'))).get()!;
  const keep = new Set(['entry', 'translate', 'translate-resend', 'save']);
  const { definition } = row;
  return { ...row, definition: { ...definition, nodes: definition.nodes.filter((node) => keep.has(node.id)), edges: definition.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)) } };
}

const TERMS_NODES = new Set(['terms', 'terms-resend', 'terms-failed', 'save-terms']);
/** The 번역 workflow without its closing 용어 추출 branch: tests that count the translate/review calls of a line. */
export function withoutTerms<T extends { nodes: { id: string }[]; edges: { source: string; target: string }[] }>(definition: T): T {
  return { ...definition, nodes: definition.nodes.filter((node) => !TERMS_NODES.has(node.id)), edges: definition.edges.filter((edge) => !TERMS_NODES.has(edge.source) && !TERMS_NODES.has(edge.target)) };
}
