import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  agentSettingsSchema,
  appDefaultsSchema,
  editorAiSchema,
  ISSUE_KINDS,
  remapIds,
  templateStatusIds,
  WORKFLOW_TEMPLATES,
  workflowDefinitionSchema,
  type AppDefaults,
  type AppDefaultSection,
  type DraftModelChoice,
  type SavedRef,
  type SavedWorkflow,
  type WorkflowDefinition,
} from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import type { SecretStore } from './secrets.ts';

/**
 * 홈 설정 (docs/DESIGN-APP-SETTINGS-2026-10-27.md): what a new project is made from. It is copied
 * once, when the project is made; afterwards the two only meet when a person asks: 가져오기 (pull,
 * home → project) or 홈 기본값으로 저장 (push, project → home). The home's connections are the
 * connection rows with no project.
 */

/** A database or a transaction: what reading and copying need. */
type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;
/** A connection copied with its key: the key is copied once the transaction is in (the keyring is not part of it). */
export type KeyCopy = [from: string, to: string];

const APP = 'app';

export function readAppDefaults(db: Pick<Db, 'select'>): AppDefaults {
  const row = db.select({ defaults: s.appSettings.defaults }).from(s.appSettings).where(eq(s.appSettings.id, APP)).get();
  return appDefaultsSchema.parse(row?.defaults ?? {});
}

/** Replaces the sections given (each whole). Throws a ZodError when the result is not valid. */
export function writeAppDefaults(db: Tx, patch: Partial<AppDefaults>): AppDefaults {
  const next = appDefaultsSchema.parse({ ...readAppDefaults(db), ...patch });
  db.insert(s.appSettings)
    .values({ id: APP, defaults: next })
    .onConflictDoUpdate({ target: s.appSettings.id, set: { defaults: next, updatedAt: new Date() } })
    .run();
  events.changed(undefined, 'app');
  return next;
}

/** One-time steps done on this data (see connection-split.ts). */
export function stepDone(db: Pick<Db, 'select'>, step: string) {
  return (db.select({ done: s.appSettings.done }).from(s.appSettings).where(eq(s.appSettings.id, APP)).get()?.done ?? []).includes(step);
}
export function markStepDone(db: Tx, step: string) {
  const done = [...new Set([...(db.select({ done: s.appSettings.done }).from(s.appSettings).where(eq(s.appSettings.id, APP)).get()?.done ?? []), step])];
  db.insert(s.appSettings).values({ id: APP, done }).onConflictDoUpdate({ target: s.appSettings.id, set: { done } }).run();
}

export function copyKeys(secrets: SecretStore | undefined, copies: KeyCopy[]) {
  if (!secrets) return;
  for (const [from, to] of copies) {
    const key = secrets.get(from);
    if (key !== null) secrets.set(to, key);
  }
}

/** Editor AI and chat settings with their connections moved; a strict choice (continuation, new chat model) left without one is cleared. */
function moveEditorAi(value: AppDefaults['editorAi'], ids: Map<string, string>): AppDefaults['editorAi'] {
  const next = remapIds(value, ids);
  return next.complete.model?.connectionId === '' ? { ...next, complete: { ...next.complete, model: null } } : next;
}
function moveAgentSettings(value: AppDefaults['agentSettings'], ids: Map<string, string>): AppDefaults['agentSettings'] {
  const next = remapIds(value, ids);
  return next.chatModel?.connectionId === '' ? { ...next, chatModel: null } : next;
}

const connectionsOf = (tx: Pick<Db, 'select'>, projectId: string | null) =>
  tx.select().from(s.connections).where(projectId === null ? isNull(s.connections.projectId) : eq(s.connections.projectId, projectId)).orderBy(asc(s.connections.name)).all();

/**
 * Copies the connections of one place (a project, or the home with null) into another: a name the
 * target already has is updated in place (its id stays, so what picks it keeps working), others are
 * added. Returns old id → target id, and the keys to copy.
 */
export function copyConnections(tx: Tx, from: string | null, to: string | null): { ids: Map<string, string>; keys: KeyCopy[] } {
  const target = new Map(connectionsOf(tx, to).map((row) => [row.name, row]));
  const ids = new Map<string, string>();
  const keys: KeyCopy[] = [];
  for (const { id, projectId: _, createdAt: __, ...fields } of connectionsOf(tx, from)) {
    const existing = target.get(fields.name);
    const targetId = existing
      ? (tx.update(s.connections).set(fields).where(eq(s.connections.id, existing.id)).run(), existing.id)
      : tx.insert(s.connections).values({ ...fields, projectId: to }).returning({ id: s.connections.id }).get().id;
    ids.set(id, targetId);
    keys.push([id, targetId]);
  }
  return { ids, keys };
}

/** Every connection id of one place → the connection of the same name in another, or '' (left empty). */
function connectionMap(tx: Pick<Db, 'select'>, from: string | null, to: string | null) {
  const byName = new Map(connectionsOf(tx, to).map((row) => [row.name, row.id]));
  return new Map(connectionsOf(tx, from).map((row) => [row.id, byName.get(row.name) ?? '']));
}

const projectStatuses = (tx: Pick<Db, 'select'>, projectId: string) => tx.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all();
/** The person's own tags (the app's tags, with a role, are every project's anyway). */
const projectTags = (tx: Pick<Db, 'select'>, projectId: string) => tx.select().from(s.tags).where(and(eq(s.tags.projectId, projectId), isNull(s.tags.role))).orderBy(asc(s.tags.sort)).all();
const aiFailedTag = (tx: Pick<Db, 'select'>, projectId: string) => tx.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.projectId, projectId), eq(s.tags.role, 'aiFailed'))).get()?.id;

/** A home workflow (a template or a saved one) made for this project: its statuses, tags and connections found by name. */
function homeWorkflows(tx: Tx, projectId: string, defaults: AppDefaults, model: DraftModelChoice): { name: string; description: string; definition: WorkflowDefinition }[] {
  const statuses = projectStatuses(tx, projectId);
  const templates = defaults.workflows.templates.flatMap((key) => {
    const template = WORKFLOW_TEMPLATES.find((entry) => entry.key === key);
    return template ? [{ name: template.name, description: template.description, definition: workflowDefinitionSchema.parse(template.build({ model, ...templateStatusIds(statuses), aiFailedTag: aiFailedTag(tx, projectId) })) }] : [];
  });
  const tags = new Map(tx.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [tag.name, tag.id]));
  const connections = new Map(connectionsOf(tx, projectId).map((row) => [row.name, row.id]));
  const byKind = templateStatusIds(statuses);
  const find = (ref: SavedRef): string => {
    if (ref.kind === 'tag') return tags.get(ref.name) ?? '';
    if (ref.kind === 'connection') return connections.get(ref.name) ?? '';
    const named = statuses.find((status) => status.name === ref.name);
    if (named) return named.id;
    const like = ref.statusKind === 'initial' ? byKind.untranslated : ref.statusKind === 'final' ? byKind.confirmed : ref.inReview ? byKind.needsReview : byKind.translated;
    return like ?? '';
  };
  const saved = defaults.workflows.saved.map((workflow) => ({
    name: workflow.name,
    description: workflow.description,
    definition: remapIds(workflow.definition, new Map(Object.entries(workflow.refs).map(([id, ref]) => [id, find(ref)]))),
  }));
  return [...templates, ...saved];
}

function insertStatuses(tx: Tx, projectId: string, defaults: AppDefaults, only?: Set<string>) {
  const from = (tx.select({ max: sql<number>`coalesce(max(${s.statuses.sort}), -1)` }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()?.max ?? -1) + 1;
  const rows = defaults.statuses.filter((status) => !only || only.has(status.name));
  rows.forEach((status, index) => tx.insert(s.statuses).values({ projectId, name: status.name, color: status.color, kind: status.kind, inReview: status.inReview, sort: from + index }).run());
  return rows.length;
}

function insertTags(tx: Tx, projectId: string, defaults: AppDefaults, only?: Set<string>) {
  const from = (tx.select({ max: sql<number>`coalesce(max(${s.tags.sort}), -1)` }).from(s.tags).where(eq(s.tags.projectId, projectId)).get()?.max ?? -1) + 1;
  const rows = defaults.tags.filter((tag) => !only || only.has(tag.name));
  rows.forEach((tag, index) => tx.insert(s.tags).values({ projectId, name: tag.name, color: tag.color, scope: tag.scope, sort: from + index }).run());
  return rows.length;
}

/**
 * A new project's start from the home: its connections, statuses, tags (and the app's AI 실패 tag),
 * editor AI, chat settings and workflows. `model` fills the templates' AI nodes (empty: validation asks).
 * Runs inside the import's transaction; copy the returned keys once it is in.
 */
export function seedProject(tx: Tx, projectId: string, model: DraftModelChoice = { connectionId: '', model: '' }): { keys: KeyCopy[] } {
  const defaults = readAppDefaults(tx);
  const { ids, keys } = copyConnections(tx, null, projectId);
  tx.update(s.projects)
    .set({ editorAi: moveEditorAi(defaults.editorAi, ids), agentSettings: moveAgentSettings(defaults.agentSettings, ids), aiAutoConfirm: defaults.aiAutoConfirm })
    .where(eq(s.projects.id, projectId))
    .run();
  insertStatuses(tx, projectId, defaults);
  tx.insert(s.tags).values({ projectId, name: ISSUE_KINDS.aiFailed.name, color: ISSUE_KINDS.aiFailed.color, role: 'aiFailed' }).run();
  insertTags(tx, projectId, defaults);
  for (const workflow of homeWorkflows(tx, projectId, defaults, model)) tx.insert(s.workflows).values({ projectId, ...workflow }).run();
  return { keys };
}

/** What a pull or push changed, for the person: section → a short count or "바꿈". */
export type SectionReport = Partial<Record<AppDefaultSection, string>>;

/**
 * 홈 기본값 가져오기: the home's sections into this project. Values are replaced; lists only gain
 * what the project lacks (by name): statuses, tags and saved instructions already there stay as
 * they are (lines and workflows point at them), and home workflows are added as new ones.
 */
export function pullDefaults(db: Db, projectId: string, sections: AppDefaultSection[], secrets?: SecretStore): SectionReport {
  const report: SectionReport = {};
  const keys: KeyCopy[] = [];
  db.transaction((tx) => {
    const defaults = readAppDefaults(tx);
    const project = tx.select({ editorAi: s.projects.editorAi, agentSettings: s.projects.agentSettings }).from(s.projects).where(eq(s.projects.id, projectId)).get();
    if (!project) return;
    const want = new Set(sections);
    if (want.has('connections')) {
      const copied = copyConnections(tx, null, projectId);
      keys.push(...copied.keys);
      report.connections = `${copied.ids.size}개`;
    }
    const ids = connectionMap(tx, null, projectId);
    const agent = agentSettingsSchema.parse(project.agentSettings ?? {});
    if (want.has('editorAi')) {
      tx.update(s.projects).set({ editorAi: moveEditorAi(defaults.editorAi, ids) }).where(eq(s.projects.id, projectId)).run();
      report.editorAi = '바꿈';
    }
    let nextAgent = agent;
    if (want.has('agentSettings')) {
      nextAgent = { ...moveAgentSettings(defaults.agentSettings, ids), prompts: nextAgent.prompts };
      report.agentSettings = '바꿈';
    }
    if (want.has('prompts')) {
      const have = new Set(nextAgent.prompts.map((prompt) => prompt.name.toLowerCase()));
      const added = defaults.agentSettings.prompts.filter((prompt) => !have.has(prompt.name.toLowerCase()));
      nextAgent = { ...nextAgent, prompts: [...nextAgent.prompts, ...added] };
      report.prompts = `${added.length}개 추가`;
    }
    if (nextAgent !== agent) tx.update(s.projects).set({ agentSettings: nextAgent }).where(eq(s.projects.id, projectId)).run();
    if (want.has('aiAutoConfirm')) {
      tx.update(s.projects).set({ aiAutoConfirm: defaults.aiAutoConfirm }).where(eq(s.projects.id, projectId)).run();
      report.aiAutoConfirm = '바꿈';
    }
    if (want.has('statuses')) {
      const have = new Set(projectStatuses(tx, projectId).map((status) => status.name));
      report.statuses = `${insertStatuses(tx, projectId, defaults, new Set(defaults.statuses.map((status) => status.name).filter((name) => !have.has(name))))}개 추가`;
    }
    if (want.has('tags')) {
      const have = new Set(tx.select({ name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => tag.name));
      report.tags = `${insertTags(tx, projectId, defaults, new Set(defaults.tags.map((tag) => tag.name).filter((name) => !have.has(name))))}개 추가`;
    }
    if (want.has('workflows')) {
      const workflows = homeWorkflows(tx, projectId, defaults, { connectionId: '', model: '' });
      for (const workflow of workflows) tx.insert(s.workflows).values({ projectId, ...workflow }).run();
      report.workflows = `${workflows.length}개 추가`;
    }
  });
  copyKeys(secrets, keys);
  const topics = [
    'projects',
    ...(sections.includes('connections') ? (['connections'] as const) : []),
    ...(sections.some((section) => section === 'statuses' || section === 'tags') ? (['statuses'] as const) : []),
    ...(sections.includes('workflows') ? (['workflows'] as const) : []),
  ] as const;
  events.changed(projectId, ...topics);
  return report;
}

/** Ids in a workflow that stand for this project's statuses, tags and connections, as names (savedWorkflowSchema.refs). */
function workflowRefs(tx: Pick<Db, 'select'>, projectId: string, definition: WorkflowDefinition): Record<string, SavedRef> {
  const known = new Map<string, SavedRef>([
    ...projectStatuses(tx, projectId).map((status) => [status.id, { kind: 'status', name: status.name, statusKind: status.kind, inReview: status.inReview }] as const),
    ...tx.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [tag.id, { kind: 'tag', name: tag.name }] as const),
    ...connectionsOf(tx, projectId).map((row) => [row.id, { kind: 'connection', name: row.name }] as const),
  ]);
  const refs: Record<string, SavedRef> = {};
  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      const ref = known.get(node);
      if (ref) refs[node] = ref;
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(definition);
  return refs;
}

/**
 * 홈 기본값으로 저장: this project's sections become the home's. Connections and saved instructions
 * are merged by name (the project's win); the rest replaces the home's. Workflows (`workflowIds`)
 * are added to the home's saved workflows, their ids kept as names.
 */
export function pushDefaults(db: Db, projectId: string, sections: AppDefaultSection[], workflowIds: string[] = [], secrets?: SecretStore): SectionReport {
  const report: SectionReport = {};
  const keys: KeyCopy[] = [];
  db.transaction((tx) => {
    const project = tx.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
    if (!project) return;
    const defaults = readAppDefaults(tx);
    const want = new Set(sections);
    const patch: Partial<AppDefaults> = {};
    if (want.has('connections')) {
      const copied = copyConnections(tx, projectId, null);
      keys.push(...copied.keys);
      report.connections = `${copied.ids.size}개`;
    }
    const ids = connectionMap(tx, projectId, null);
    const agent = agentSettingsSchema.parse(project.agentSettings ?? {});
    if (want.has('editorAi')) {
      patch.editorAi = moveEditorAi(editorAiSchema.parse(project.editorAi ?? {}), ids);
      report.editorAi = '바꿈';
    }
    if (want.has('agentSettings')) {
      patch.agentSettings = { ...moveAgentSettings(agent, ids), prompts: defaults.agentSettings.prompts };
      report.agentSettings = '바꿈';
    }
    if (want.has('prompts')) {
      const mine = new Set(agent.prompts.map((prompt) => prompt.name.toLowerCase()));
      const base = patch.agentSettings ?? defaults.agentSettings;
      patch.agentSettings = { ...base, prompts: [...base.prompts.filter((prompt) => !mine.has(prompt.name.toLowerCase())), ...agent.prompts] };
      report.prompts = `${agent.prompts.length}개`;
    }
    if (want.has('aiAutoConfirm')) {
      patch.aiAutoConfirm = project.aiAutoConfirm;
      report.aiAutoConfirm = '바꿈';
    }
    if (want.has('statuses')) {
      patch.statuses = projectStatuses(tx, projectId).map(({ id, name, color, kind, inReview }) => ({ id, name, color, kind, inReview }));
      report.statuses = `${patch.statuses.length}개`;
    }
    if (want.has('tags')) {
      patch.tags = projectTags(tx, projectId).map(({ id, name, color, scope }) => ({ id, name, color, scope }));
      report.tags = `${patch.tags.length}개`;
    }
    if (want.has('workflows') && workflowIds.length) {
      const rows = tx.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().filter((row) => workflowIds.includes(row.id));
      const saved: SavedWorkflow[] = rows.map((row) => ({ id: crypto.randomUUID(), name: row.name, description: row.description, definition: row.definition, refs: workflowRefs(tx, projectId, row.definition) }));
      patch.workflows = { ...defaults.workflows, saved: [...defaults.workflows.saved, ...saved] };
      report.workflows = `${saved.length}개 추가`;
    }
    writeAppDefaults(tx, patch);
  });
  copyKeys(secrets, keys);
  if (sections.includes('connections')) events.changed(undefined, 'connections');
  return report;
}
