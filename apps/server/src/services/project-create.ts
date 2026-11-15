import { detectFormatRules, formatRulesSchema, newFormats, type DraftModelChoice, type FormatOffer, type FormatRules, type ImportFile, type NewProject, type NodeType } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { copyKeys, seedProject, type KeyCopy } from '../domain/app-defaults.ts';
import type { SecretStore } from '../domain/secrets.ts';
import type { Tx } from './source-mutations.ts';
import { eq } from 'drizzle-orm';
import { addSource } from './source-add.ts';

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

/** The format rules a project made from this file starts with: the file's own, else the presets its lines use (else the defaults). */
export function startingFormatRules(file: ImportFile): FormatRules {
  if (file.project.formatRules) return file.project.formatRules;
  const detected = detectFormatRules(file.units.map((unit) => unit.source));
  return detected.recommendedPresets.length ? { presets: detected.recommendedPresets, custom: [] } : formatRulesSchema.parse({});
}

/** The formats the file's lines use beyond what a project made from it starts with: the ones to ask about turning on. */
export const fileFormatOffers = (file: ImportFile): FormatOffer[] => newFormats(file.units.map((unit) => unit.source), startingFormatRules(file));

export interface FileProjectSummary {
  projectId: string;
  groups: number;
  units: number;
  graphNodes: number;
  graphEdges: number;
}

/**
 * A new project from a standard file (새 프로젝트 › 파일에서, `loca projects import`): an empty project from the 홈 설정
 * (createProject) with the file put in the way any file is (addSource), so a project made from a file and a file added
 * later are the same thing; the 원문 넣기 log keeps it as the file the project was made from. `formats`: the offered
 * formats (fileFormatOffers) to turn on as well. Should putting the file in fail, the half-made project goes.
 */
export function createProjectFromFile(db: Db, file: ImportFile, model: DraftModelChoice = { connectionId: '', model: '' }, secrets?: SecretStore, extra: { formats?: string[]; name?: string } = {}): FileProjectSummary {
  const { formatRules: _own, ...facts } = file.project;
  const { projectId, keys } = db.transaction((tx) => insertProject(tx, { ...facts, formatRules: startingFormatRules(file) }, model));
  copyKeys(db, secrets, keys);
  try {
    const { added } = addSource(db, projectId, { ...file, formats: extra.formats ?? [], update: false, name: extra.name }, 'new');
    return { projectId, ...added };
  } catch (error) {
    db.delete(s.projects).where(eq(s.projects.id, projectId)).run();
    throw error;
  }
}
