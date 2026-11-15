import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

/** The project's 원문 넣기 log, newest first (the sourceImports collection; `loca source log`); only `ids` when given. */
export const sourceImportRows = (db: Pick<Db, 'select'>, projectId: string, ids?: readonly string[]) =>
  db.select().from(s.sourceImports).where(and(eq(s.sourceImports.projectId, projectId), ids ? inList(s.sourceImports.id, ids) : undefined)).orderBy(desc(s.sourceImports.createdAt)).all();
