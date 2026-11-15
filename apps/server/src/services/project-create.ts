import type { DraftModelChoice, FormatRules, NewProject, NodeType } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { copyKeys, seedProject, type KeyCopy } from '../domain/app-defaults.ts';
import type { SecretStore } from '../domain/secrets.ts';
import type { Tx } from './source-mutations.ts';

/** What a file brings beyond the project's own facts: its node types and the format rules its strings use. */
export interface ProjectExtras {
  nodeTypes?: Record<string, NodeType>;
  formatRules?: FormatRules;
}

/**
 * A project row started from the 홈 설정 (seedProject: its connections, statuses, tags, editor and chat
 * settings, workflows), inside the caller's transaction. The copied connections' keys are copied by the
 * caller once the transaction is in (copyKeys), since the key store is outside the database.
 */
export function insertProject(tx: Tx, project: NewProject & ProjectExtras, model: DraftModelChoice = { connectionId: '', model: '' }): { projectId: string; keys: KeyCopy[] } {
  const projectId = crypto.randomUUID();
  const { formatRules, nodeTypes, ...facts } = project;
  tx.insert(s.projects)
    .values({ id: projectId, ...facts, nodeTypes: nodeTypes ?? {}, ...(formatRules && { formatRules }) })
    .run();
  return { projectId, keys: seedProject(tx, projectId, model).keys };
}

/** A new, empty project (the app's 새 프로젝트, `loca projects create`): its lines come later, written or imported. */
export function createProject(db: Db, project: NewProject, secrets?: SecretStore): { projectId: string } {
  const { projectId, keys } = db.transaction((tx) => insertProject(tx, project));
  copyKeys(db, secrets, keys);
  return { projectId };
}
