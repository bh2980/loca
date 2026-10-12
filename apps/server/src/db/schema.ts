import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { KNOWLEDGE_ORIGINS, KNOWLEDGE_STATUSES, LISTENER_ORIGINS, SPEECH_LEVELS, type AgentSettings, type ContextItem, type FormatRules, type NodeType, type PiOptions, type RelationshipChange, type WorkflowDefinition } from '@tw/shared';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date());
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const projectId = () => text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' });
/**
 * Shared by every knowledge table. AI drafts land as candidates and are not used as context until
 * a person confirms them; evidence is the line keys a draft cites; jobId is the analysis that wrote it.
 */
const knowledge = () => ({
  status: text('status', { enum: KNOWLEDGE_STATUSES }).notNull().default('confirmed'),
  origin: text('origin', { enum: KNOWLEDGE_ORIGINS }).notNull().default('human'),
  evidence: json<string[]>('evidence').notNull().default(sql`'[]'`),
  jobId: text('job_id'),
  /** A person edited or confirmed this AI item: a new analysis leaves it alone. */
  reviewed: integer('reviewed', { mode: 'boolean' }).notNull().default(false),
});

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
    /** Position in the whole project script (0..n-1): group order, then unit order. The one key for script order. */
    seq: integer('seq').notNull().default(0),
    kind: text('kind', { enum: ['dialogue', 'document', 'ui'] }).notNull(),
    speaker: text('speaker'),
    /** Who the line is addressed to: a character name, or null when unknown. */
    listener: text('listener'),
    listenerOrigin: text('listener_origin', { enum: LISTENER_ORIGINS }),
    /** The AI's confidence (0..1) for an AI-set listener; below the threshold it counts as unknown. */
    listenerConfidence: real('listener_confidence'),
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
    index('units_seq').on(t.projectId, t.seq),
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
  /** Scene graph: hub nodes ("연결점") laid out among the scenes; their ids start with "hub:". */
  hubs?: { id: string; nodes: number; scenes: number }[];
  /**
   * Dialogue graph: real edges left out of the layout because they touch a hub (a node with very
   * many connections); drawn as straight lines between the placed nodes.
   */
  looseEdges?: { id: string; from: string; to: string }[];
  /** One section's dialogue graph: stand-ins ("portal:in|out:<section>") for the lines in other sections it links to. */
  portals?: { id: string; section: string; direction: 'in' | 'out'; /** In a view of chosen scenes: the scene the lines continue in. */ groupId?: string }[];
  /** A view of chosen scenes (section "view:<hash>"): which, for the header. */
  view?: { groupIds: string[]; titles: string[] };
}

export const graphLayouts = sqliteTable(
  'graph_layouts',
  {
    projectId: projectId(),
    scope: text('scope', { enum: ['dialogue', 'scene'] }).notNull(),
    /** '' for the whole graph; a section name for that section's own dialogue layout. */
    section: text('section').notNull().default(''),
    status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull(),
    data: json<LayoutData>('data'),
    error: text('error'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.scope, t.section] })],
);

export const terms = sqliteTable('terms', {
  id: id(),
  projectId: projectId(),
  source: text('source').notNull(),
  target: text('target').notNull().default(''),
  note: text('note').notNull().default(''),
  /** Candidates (extracted by a workflow, found in the script) are not used as context until a person confirms them; rejected ones are not proposed again. */
  status: text('status', { enum: KNOWLEDGE_STATUSES }).notNull().default('confirmed'),
  origin: text('origin', { enum: KNOWLEDGE_ORIGINS }).notNull().default('human'),
  /** Script lines that contain it, when it was found in the script ("대본에서 찾기"). */
  lines: integer('lines'),
  /** Keys of the first lines that contain it, in script order. */
  examples: json<string[]>('examples').notNull().default(sql`'[]'`),
  /** The workflow run that added it, for AI terms. */
  runId: text('run_id'),
  /** A person edited or promoted this AI term. */
  reviewed: integer('reviewed', { mode: 'boolean' }).notNull().default(false),
  updatedAt: updatedAt(),
});

export const documents = sqliteTable('documents', {
  id: id(),
  projectId: projectId(),
  kind: text('kind', { enum: ['story', 'world', 'style', 'note'] }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  alwaysInclude: integer('always_include', { mode: 'boolean' }).notNull().default(false),
  ...knowledge(),
  updatedAt: updatedAt(),
});

export const characters = sqliteTable('characters', {
  id: id(),
  projectId: projectId(),
  name: text('name').notNull(),
  aliases: json<string[]>('aliases').notNull().default(sql`'[]'`),
  profile: text('profile').notNull().default(''),
  /** How the character talks (observed in the source), not the Korean rule. */
  speech: text('speech').notNull().default(''),
  /** The player character: may be addressed even if it never speaks. */
  player: integer('player', { mode: 'boolean' }).notNull().default(false),
  ...knowledge(),
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
  /** Where and why the relationship changed, in script order. */
  changes: json<RelationshipChange[]>('changes').notNull().default(sql`'[]'`),
  ...knowledge(),
});

export const storyEvents = sqliteTable('story_events', {
  id: id(),
  projectId: projectId(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  cause: text('cause').notNull().default(''),
  outcome: text('outcome').notNull().default(''),
  /** Character names. */
  participants: json<string[]>('participants').notNull().default(sql`'[]'`),
  ...knowledge(),
  updatedAt: updatedAt(),
});

/**
 * A Korean speech rule for one speaker → listener direction. Several rules for the same pair are
 * intervals: each applies from its start line (null = from the beginning) until the next one.
 */
export const speechRules = sqliteTable(
  'speech_rules',
  {
    id: id(),
    projectId: projectId(),
    fromName: text('from_name').notNull(),
    toName: text('to_name').notNull(),
    level: text('level', { enum: SPEECH_LEVELS }).notNull(),
    /** How the speaker addresses the listener in Korean, e.g. "수사관님". */
    address: text('address').notNull().default(''),
    note: text('note').notNull().default(''),
    /** Why an AI rule waits for a person (main pair, conflict, evidence…); cleared when a person decides. */
    review: text('review'),
    startKey: text('start_key'),
    ...knowledge(),
    updatedAt: updatedAt(),
  },
  (t) => [index('speech_rules_pair').on(t.projectId, t.fromName, t.toName)],
);

export type AnalysisStatus = 'running' | 'completed' | 'failed' | 'cancelled';
/** A whole-script analysis (work analysis): one per run, its drafts carry its id. */
export const analysisJobs = sqliteTable(
  'analysis_jobs',
  {
    id: id(),
    projectId: projectId(),
    profileId: text('profile_id'),
    model: text('model'),
    status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull(),
    partsDone: integer('parts_done').notNull().default(0),
    partsTotal: integer('parts_total').notNull().default(1),
    usage: json<{ inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningTokens?: number; costUsd?: number }>('usage'),
    /** Counts of drafts written, by kind. */
    result: json<Record<string, number>>('result'),
    /** Per part: a hash of its script text and the model's answer, so a failed job can be resumed. */
    parts: json<{ hash: string; answer: unknown }[]>('parts'),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('analysis_jobs_project').on(t.projectId, t.createdAt)],
);

/** App-wide: connections and profiles are shared by every project. Secrets live in the OS keyring. */
export const connections = sqliteTable('connections', {
  id: id(),
  kind: text('kind', { enum: ['openai', 'pi', 'systemone', 'codex', 'claude', 'grok', 'antigravity', 'opencode', 'http'] }).notNull(),
  name: text('name').notNull(),
  baseUrl: text('base_url'),
  executable: text('executable'),
  headerTemplate: text('header_template'),
  createdAt: createdAt(),
  /** pi connections: packages, extensions and built-in tools to load (see piOptionsSchema). */
  options: json<PiOptions>('options'),
  /** Model calls this account takes at once, shared by every run. */
  concurrency: integer('concurrency').notNull().default(2),
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
    /** Caps the person set when starting; the run pauses when one is reached. */
    limits: json<RunLimits>('limits'),
    /** Why the runner paused the run on its own (a guard, an error); cleared on resume. */
    notice: text('notice'),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('runs_project').on(t.projectId, t.createdAt)],
);

export interface RunLimits {
  maxCalls?: number;
  /** All input tokens, cached included, as the connections reported them. */
  maxInputTokens?: number;
}

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
  /** Times the line went back to a node's queue because a call left it out or failed transiently, by node id. */
  retries?: Record<string, number>;
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
    /** The run plan's batch this line belongs to (see planRun); null for runs started before plans. */
    plan: integer('plan'),
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
    /** The profile the call went out with: a node can share its work over several. */
    profileId: text('profile_id'),
    model: text('model'),
    prompt: text('prompt'),
    /** What went into the prompt besides the lines, why, and what was dropped for the cap. */
    context: json<ContextItem[]>('context'),
    output: json<unknown>('output'),
    error: text('error'),
    attempts: json<unknown[]>('attempts'),
    /** Usage of every attempt of this call (failed ones included), as the connections reported it. */
    inputTokens: integer('input_tokens'),
    /** The part of `inputTokens` read from the provider's prompt cache. */
    cachedInputTokens: integer('cached_input_tokens'),
    outputTokens: integer('output_tokens'),
    /** The reasoning part of `outputTokens`. */
    reasoningTokens: integer('reasoning_tokens'),
    /** USD the connection reported; never estimated. */
    costUsd: real('cost_usd'),
    /** Lines a per-line answer covered (non-empty); the request is `unitIds`. */
    returnedLines: integer('returned_lines'),
    /** 0 for a batch's first request, n for the n-th request for the lines it left out. */
    round: integer('round').notNull().default(0),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('run_steps_run').on(t.runId, t.startedAt)],
);

/**
 * A change an agent asked for outside the AI SDK approval flow (pi chat, the CLI). Nothing is
 * applied until a person accepts it in the chat panel; then the same tool runs with this input.
 */
/** Lines a batch proposal left out (errors, conflicts) and warnings about the ones it kept. */
export interface ProposalReport {
  dropped: { key: string; reason: string }[];
  warnings: { key: string; issues: string[] }[];
}

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
    /** What the check at proposing time left out or warns about (see proposal-check.ts). */
    report: json<ProposalReport>('report'),
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
  /** An agent CLI's own session for this chat (resumed each turn), and when it last took a turn. */
  agentSession: json<{ kind: string; model: string; id: string; lastTurnAt: number }>('agent_session'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
