import { eq } from 'drizzle-orm';
import { ISSUE_KIND_IDS, ISSUE_KINDS, type IssueKind } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

type Tx = Pick<Db, 'select' | 'insert'>;

const lower = (text: string) => text.trim().toLowerCase();

/**
 * The tags a new project starts with for what checks and reviews find (ISSUE_KINDS: 형식 오류, 말투 어긋남 … AI 실패):
 * ordinary tags on lines, with their 설명. A name the project already has (a home default of the same name) is left as
 * it is. After this they are the project's tags like any other: renamed, recoloured or deleted.
 */
export function seedIssueTags(tx: Tx, projectId: string) {
  const have = new Set(tx.select({ name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => lower(tag.name)));
  for (const kind of ISSUE_KIND_IDS) {
    const { name, color, description } = ISSUE_KINDS[kind];
    if (!have.has(lower(name))) tx.insert(s.tags).values({ projectId, name, color, description, scope: ['lines'] }).run();
  }
}

/** The project's tag for each kind, by the name a new project gives it (any case): what a template wires its tag nodes to. */
export function issueTagIds(db: Pick<Db, 'select'>, projectId: string): Partial<Record<IssueKind, string>> {
  const byName = new Map(db.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [lower(tag.name), tag.id]));
  return Object.fromEntries(ISSUE_KIND_IDS.flatMap((kind) => {
    const id = byName.get(lower(ISSUE_KINDS[kind].name));
    return id ? [[kind, id]] : [];
  }));
}
