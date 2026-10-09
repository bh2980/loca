import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AgentSettings, FormatRules, NodeType, PiOptions, WorkflowDefinition } from '@tw/shared';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date());
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const projectId = () => text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' });

export const projects = sqliteTable('projects', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sourceLanguage: text('source_language').notNull(),
  targetLanguage: text('target_language').notNull(),
  /** The source graph's node-type dictionary from the standard file. */
  nodeTypes: json<Record<string, NodeType>>('node_types').notNull().default(sql`'{}'`),
  /** Whether the source graph is the game's whole flow (see GRAPH_FLOWS). */
  graphFlow: text('graph_flow', { enum: ['complete', 'partial'] }).notNull().default('partial'),
  /** Which placeholder / tag families the format check looks for (see FORMAT_PRESETS). */
  /** Which agent tools this project's chat (and the CLI) may use. */
  agentSettings: json<AgentSettings>('agent_settings').notNull().default(sql`'{"disabledTools":[]}'`),
  formatRules: json<FormatRules>('format_rules').notNull().default(sql`'{"presets":["brace","printf","angleTag"],"custom":[]}'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const statuses = sqliteTable('statuses', {
  id: id(),
  projectId: projectId(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  kind: text('kind', { enum: ['initial', 'normal', 'final'] }).notNull(),
  sort: integer('sort').notNull(),
  /** Lines in this status are listed in the review inbox, however they got there. */
  inReview: integer('in_review', { mode: 'boolean' }).notNull().default(false),
});

export const tags = sqliteTable('tags', {
  id: id(),
  projectId: projectId(),
  name: text('name').notNull(),
  color: text('color').notNull(),
});

export const groups = sqliteTable(
  'groups',
  {
    id: id(),
    projectId: projectId(),
    key: text('key').notNull(),
    kind: text('kind', { enum: ['scene', 'document', 'ui'] }).notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Display folder in the script list, e.g. a chapter or a document's source. */
    section: text('section'),
    sort: integer('sort').notNull(),
    meta: json<Record<string, unknown>>('meta'),
  },
  (t) => [uniqueIndex('groups_key').on(t.projectId, t.key), index('groups_sort').on(t.projectId, t.sort)],
);

export const units = sqliteTable(
  'units',
  {
    id: id(),
    projectId: projectId(),
    groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    sort: integer('sort').notNull(),
    kind: text('kind', { enum: ['dialogue', 'document', 'ui'] }).notNull(),
    speaker: text('speaker'),
    source: text('source').notNull(),
    /** The representative translation. Candidates hold every version. */
    translation: text('translation'),
    candidateId: text('candidate_id'),
    statusId: text('status_id').notNull().references(() => statuses.id),
    meta: json<Record<string, unknown>>('meta'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('units_key').on(t.projectId, t.key),
    index('units_group').on(t.groupId, t.sort),
    index('units_status').on(t.projectId, t.statusId),
  ],
);

export const unitTags = sqliteTable(
  'unit_tags',
  {
    unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.unitId, t.tagId] }), index('unit_tags_tag').on(t.tagId)],
);

export const candidates = sqliteTable(
  'candidates',
  {
    id: id(),
    unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    origin: text('origin', { enum: ['ai', 'human', 'import', 'tool'] }).notNull(),
    profileId: text('profile_id'),
    model: text('model'),
    runId: text('run_id'),
    nodeId: text('node_id'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('candidates_unit').on(t.unitId, t.createdAt)],
);

export const graphNodes = sqliteTable(
  'graph_nodes',
  {
    id: id(),
    projectId: projectId(),
    key: text('key').notNull(),
    /** Original node class from the game (see projects.nodeTypes). */
    type: text('type'),
    kind: text('kind').notNull(),
    label: text('label'),
    /** Group of the node's first unit; control nodes without text have none. */
    groupId: text('group_id'),
    unitIds: json<string[]>('unit_ids').notNull(),
    meta: json<Record<string, unknown>>('meta'),
  },
  (t) => [uniqueIndex('graph_nodes_key').on(t.projectId, t.key), index('graph_nodes_group').on(t.groupId)],
);

export const graphEdges = sqliteTable(
  'graph_edges',
  {
    id: id(),
    projectId: projectId(),
    fromId: text('from_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
    toId: text('to_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
    kind: text('kind'),
    label: text('label'),
  },
  (t) => [index('graph_edges_from').on(t.fromId), index('graph_edges_to').on(t.toId)],
);

export interface LayoutData {
  width: number;
  height: number;
  nodes: { id: string; x: number; y: number; width: number; height: number }[];
  edges: { id: string; from: string; to: string; points: number[] }[];
  /** Labelled areas drawn behind nodes, e.g. the block of unconnected lines. */
  regions?: { label: string; x: number; y: number; width: number; height: number }[];
  /** Scene links left out of the drawing because another path already connects them (see reduceSceneEdges). */
  hiddenEdges?: { from: string; to: string }[];
}

export const graphLayouts = sqliteTable(
  'graph_layouts',
  {
    projectId: projectId(),
    scope: text('scope', { enum: ['dialogue', 'scene'] }).notNull(),
    status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull(),
    data: json<LayoutData>('data'),
    error: text('error'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.scope] })],
);

export const terms = sqliteTable('terms', {
  id: id(),
  projectId: projectId(),
  source: text('source').notNull(),
  target: text('target').notNull().default(''),
  note: text('note').notNull().default(''),
  /** Candidates (e.g. extracted by a workflow) are not used as context until a person confirms them. */
  status: text('status', { enum: ['candidate', 'confirmed'] }).notNull().default('confirmed'),
  /** Where a candidate came from, e.g. "run:<id>". */
  origin: text('origin'),
  updatedAt: updatedAt(),
});

export const documents = sqliteTable('documents', {
  id: id(),
  projectId: projectId(),
  kind: text('kind', { enum: ['story', 'world', 'style', 'note'] }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  alwaysInclude: integer('always_include', { mode: 'boolean' }).notNull().default(false),
  updatedAt: updatedAt(),
});

export const characters = sqliteTable('characters', {
  id: id(),
  projectId: projectId(),
  name: text('name').notNull(),
  aliases: json<string[]>('aliases').notNull().default(sql`'[]'`),
  profile: text('profile').notNull().default(''),
  updatedAt: updatedAt(),
});

export const relationships = sqliteTable('relationships', {
  id: id(),
  projectId: projectId(),
  fromId: text('from_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  toId: text('to_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  description: text('description').notNull().default(''),
  mutual: integer('mutual', { mode: 'boolean' }).notNull().default(false),
});

/** App-wide: connections and profiles are shared by every project. Secrets live in the OS keyring. */
export const connections = sqliteTable('connections', {
  id: id(),
  kind: text('kind', { enum: ['openai', 'pi', 'systemone', 'codex', 'claude', 'grok', 'antigravity', 'http'] }).notNull(),
  name: text('name').notNull(),
  baseUrl: text('base_url'),
  executable: text('executable'),
  headerTemplate: text('header_template'),
  createdAt: createdAt(),
  /** pi connections: packages, extensions and built-in tools to load (see piOptionsSchema). */
  options: json<PiOptions>('options'),
});

export interface FallbackRoute {
  connectionId: string;
  model: string;
  effort?: string;
}

export const profiles = sqliteTable('profiles', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  connectionId: text('connection_id').notNull().references(() => connections.id),
  model: text('model').notNull(),
  effort: text('effort'),
  instructions: text('instructions').notNull().default(''),
  temperature: real('temperature'),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  timeoutSeconds: integer('timeout_seconds').notNull(),
  maxAttempts: integer('max_attempts').notNull(),
  fallbacks: json<FallbackRoute[]>('fallbacks').notNull().default(sql`'[]'`),
  updatedAt: updatedAt(),
});

export const workflows = sqliteTable('workflows', {
  id: id(),
  projectId: projectId(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  version: integer('version').notNull().default(1),
  definition: json<WorkflowDefinition>('definition').notNull(),
  updatedAt: updatedAt(),
});

export type RunStatus = 'running' | 'paused' | 'cancelled' | 'completed';
export interface RunScope {
  groupIds?: string[];
  unitIds?: string[];
  /** Lines carrying any of these tags. */
  tagIds?: string[];
  /** Run the picked lines even if their status is not one the entry node accepts. */
  ignoreStatus?: boolean;
}
export interface ProfileSnapshot {
  id: string;
  name: string;
  instructions: string;
  temperature: number | null;
  maxOutputTokens: number;
  timeoutSeconds: number;
  maxAttempts: number;
  routes: { connectionId: string; kind: string; baseUrl: string | null; executable: string | null; model: string; effort: string | null; piOptions?: PiOptions | null }[];
}

export const runs = sqliteTable(
  'runs',
  {
    id: id(),
    projectId: projectId(),
    workflowId: text('workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
    workflowName: text('workflow_name').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    definition: json<WorkflowDefinition>('definition').notNull(),
    profiles: json<Record<string, ProfileSnapshot>>('profiles').notNull(),
    scope: json<RunScope>('scope').notNull(),
    status: text('status', { enum: ['running', 'paused', 'cancelled', 'completed'] }).notNull(),
    total: integer('total').notNull(),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('runs_project').on(t.projectId, t.createdAt)],
);

export type ItemState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface ItemData {
  /** The line's current candidate in this run (set by AI, HTTP, script or a person). */
  candidateId?: string;
  candidateText?: string;
  /** Problems found by the most recent failing verdict or check; cleared by a new candidate. */
  issues?: string[];
  /** Every node's output for this line, by node id. Conditions and later nodes read these. */
  outputs?: Record<string, Record<string, unknown>>;
  /** Nodes and exits taken, for display. */
  path: { nodeId: string; port: string; at: number }[];
}

export const runItems = sqliteTable(
  'run_items',
  {
    id: id(),
    runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    state: text('state', { enum: ['queued', 'running', 'done', 'failed', 'cancelled'] }).notNull(),
    visits: json<Record<string, number>>('visits').notNull(),
    data: json<ItemData>('data').notNull(),
    error: text('error'),
    updatedAt: updatedAt(),
  },
  (t) => [index('run_items_run').on(t.runId, t.state, t.nodeId), index('run_items_unit').on(t.unitId)],
);

export const runSteps = sqliteTable(
  'run_steps',
  {
    id: id(),
    runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    unitIds: json<string[]>('unit_ids').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    model: text('model'),
    prompt: text('prompt'),
    output: json<unknown>('output'),
    error: text('error'),
    attempts: json<unknown[]>('attempts'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('run_steps_run').on(t.runId, t.startedAt)],
);

/**
 * A change an agent asked for outside the AI SDK approval flow (pi chat, the CLI). Nothing is
 * applied until a person accepts it in the chat panel; then the same tool runs with this input.
 */
export const proposals = sqliteTable(
  'proposals',
  {
    id: id(),
    projectId: projectId(),
    /** Chat session that produced it; null for changes sent from the CLI. */
    sessionId: text('session_id'),
    source: text('source', { enum: ['pi', 'cli'] }).notNull(),
    tool: text('tool').notNull(),
    input: json<Record<string, unknown>>('input').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'failed'] }).notNull().default('pending'),
    result: json<unknown>('result'),
    createdAt: createdAt(),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('proposals_project').on(t.projectId, t.status)],
);

export const chatSessions = sqliteTable('chat_sessions', {
  id: id(),
  projectId: projectId(),
  title: text('title').notNull(),
  profileId: text('profile_id'),
  messages: json<unknown[]>('messages').notNull().default(sql`'[]'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
