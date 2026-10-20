import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { AGE_BANDS, CHARACTER_ROLES, GENDERS, KNOWLEDGE_TAG_KINDS, TAG_ROLES, type TagRole, type TagScope, KNOWLEDGE_ORIGINS, KNOWLEDGE_STATUSES, LISTENER_ORIGINS, SPEECH_LEVELS, STATUS_BY, type AgentSettings, PERMISSION_MODES, type AiConfirm, type CharacterStyle, type EditorAi, type ExclusionRules, type ModelLimits, LINE_TRANSLATE, type LineMark, type MarkColors, type ModelChoice, type ContextItem, type FormatRules, type ItemErrorKind, type NodeType, type RelationshipChange, type WorkflowDefinition, WORKFLOW_SUBJECT_IDS, type WorkflowSubject } from '@tw/shared';
import type { Usage } from '@tw/ai';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date());
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const projectId = () => text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' });
/**
 * Shared by every knowledge table. AI drafts land as candidates and are not used as context until
 * a person confirms them; evidence is the line keys a draft cites.
 */
const knowledge = () => ({
  status: text('status', { enum: KNOWLEDGE_STATUSES }).notNull().default('confirmed'),
  origin: text('origin', { enum: KNOWLEDGE_ORIGINS }).notNull().default('human'),
  evidence: json<string[]>('evidence').notNull().default(sql`'[]'`),
  /** Who put it in its current status. An AI item a person never touched stays "ai"; a new analysis may replace it. */
  statusBy: text('status_by', { enum: STATUS_BY }).notNull().default('human'),
});

export const projects = sqliteTable('projects', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sourceLanguage: text('source_language').notNull(),
  targetLanguage: text('target_language').notNull(),
  /** The source graph's node-type dictionary from the standard file. */
  nodeTypes: json<Record<string, NodeType>>('node_types').notNull().default(sql`'{}'`),
  /** Which placeholder / tag families the format check looks for (see FORMAT_PRESETS). */
  /** Which agent tools this project's chat (and the CLI) may use. */
  agentSettings: json<AgentSettings>('agent_settings').notNull().default(sql`'{"disabledTools":[]}'`),
  formatRules: json<FormatRules>('format_rules').notNull().default(sql`'{"presets":["brace","printf","angleTag"],"custom":[]}'`),
  /** What becomes of AI results per knowledge kind (AI › 사용 방식). Absent kinds: auto. */
  aiConfirm: json<Partial<AiConfirm>>('ai_confirm').notNull().default(sql`'{}'`),
  /** 번역 제외: which sources are not for translation (exclusionRulesSchema; {} = the defaults). */
  exclusionRules: json<Partial<ExclusionRules>>('exclusion_rules').notNull().default(sql`'{}'`),
  /** The editor's AI continuation (off by default; see editorAiSchema). */
  editorAi: json<Partial<EditorAi>>('editor_ai').notNull().default(sql`'{}'`),
  /** Colors the project picked for automatic marks (AUTO_MARKS); others keep their default. */
  markColors: json<MarkColors>('mark_colors').notNull().default(sql`'{}'`),
  /** The arms a person picked for the main route (본 줄기): graph node id of a fork → the node it goes on to. */
  routePicks: json<Record<string, string>>('route_picks').notNull().default(sql`'{}'`),
  /** 합류 점검: join block id of the route slice → when a person checked it and the signature of the lines they read (services/join-check.ts). */
  joinChecks: json<Record<string, { at: string; sig: string }>>('join_checks').notNull().default(sql`'{}'`),
  /** 길 N (다음 길): the round of the route being translated and the picks of the earlier rounds, to step back (services/next-route.ts). */
  routeState: json<{ round: number; history: Record<string, string>[] }>('route_state').notNull().default(sql`'{"round":1,"history":[]}'`),
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
  /** A tag the app keeps: a problem type on lines (ISSUE_KINDS) or 확인 권장 on knowledge (REVIEW_TAG); null for a person's own tag. */
  role: text('role', { enum: TAG_ROLES as unknown as [TagRole, ...TagRole[]] }),
  /** Where a person's own tag can be put (the app's tags derive theirs from the role: tagScope). */
  scope: json<TagScope[]>('scope').notNull().default(sql`'["lines","terms","people","documents","events"]'`),
  /** Order among the person's own tags (the app's tags list first, by name). */
  sort: integer('sort').notNull().default(0),
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
    /** Who set the current status: a run (statusRunId) or a person (an edit, a confirm, an accepted proposal, the import). */
    statusBy: text('status_by', { enum: STATUS_BY }).notNull().default('human'),
    statusRunId: text('status_run_id'),
    /** A person's call on 번역 제외: include = translate whatever the rules say, exclude = leave it out; null = the rules decide. */
    translate: text('translate', { enum: LINE_TRANSLATE }),
    /** A person's note on the line (a doubt, a question for the developer); empty = none. */
    note: text('note').notNull().default(''),
    meta: json<Record<string, unknown>>('meta'),
    // This is also the optimistic-concurrency revision. Multiple writes in one millisecond
    // (or a clock correction) must not make a later human edit invisible to undo/conflict checks.
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
      .$onUpdateFn(() => sql`max(updated_at + 1, ${Date.now()})`),
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

/**
 * Tags on knowledge items (terms, documents, people, relationships, events, speech rules): the same
 * project tags as lines. `note` says why the app put it there (확인 권장's reasons); a person's own
 * tag has none. Rows go with their item (triggers in the migration) and with their tag (cascade).
 */
export const knowledgeTags = sqliteTable(
  'knowledge_tags',
  {
    kind: text('kind', { enum: KNOWLEDGE_TAG_KINDS }).notNull(),
    itemId: text('item_id').notNull(),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.kind, t.itemId, t.tagId] }), index('knowledge_tags_tag').on(t.tagId)],
);

export const candidates = sqliteTable(
  'candidates',
  {
    id: id(),
    unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    origin: text('origin', { enum: ['ai', 'human', 'import', 'tool'] }).notNull(),
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

/** What a view's derived edge leaves out: the source nodes on its paths, their lines, line-less nodes and speakers. */
export interface OmittedFacts {
  nodeIds: string[];
  lines: number;
  controls: number;
  speakers: string[];
  moreSpeakers: number;
}

export interface LayoutData {
  width: number;
  height: number;
  nodes: { id: string; x: number; y: number; width: number; height: number }[];
  /** `label`: a choice or condition written on the edge; `via`: the choice node it stands for. */
  /** `curved`: points are a start and (control, control, end) triples, drawn as Bézier curves. */
  /**
   * `derived`: a view's edge across nodes the view leaves out (see viewEdges in services/layout.ts),
   * not a stored edge; `omitted` counts what it stands for, from the source graph.
   */
  edges: { id: string; from: string; to: string; points: number[]; label?: string; via?: string; labelAt?: [x: number, y: number, width: number, height: number]; curved?: true; derived?: true; omitted?: OmittedFacts }[];
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
  /** A view an agent made (section "view:<id>", see graph-views.ts): what it shows, for the header. */
  view?: { label: string; nodes: number };
  /** Dialogue graph: straight runs folded into one block ("chain:<first node>"), with their nodes in order (see chains.ts). */
  chains?: { id: string; nodeIds: string[] }[];
  /** How the layout was made (LAYOUT_VERSION); older stored layouts are recomputed at startup. */
  version?: number;
}

export const graphLayouts = sqliteTable(
  'graph_layouts',
  {
    projectId: projectId(),
    scope: text('scope', { enum: ['dialogue', 'scene'] }).notNull(),
    /** '' for the whole graph; a section name for that section's own dialogue layout. */
    section: text('section').notNull().default(''),
    direction: text('direction', { enum: ['vertical', 'horizontal'] }).notNull().default('vertical'),
    status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull(),
    data: json<LayoutData>('data'),
    error: text('error'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.scope, t.section, t.direction] })],
);

/**
 * A set of dialogue-graph nodes an agent picked for the user ("show me where Mira talks to
 * Jonas"): highlighted in the graph (`mark=<id>`) or laid out on their own (section "view:<id>").
 * The id is a hash of the node ids, so asking for the same set again reuses it.
 */
/**
 * A stored view of the dialogue graph (like a database view): only which nodes to keep. Edges
 * between them and the layout are computed from the source graph each time (services/layout.ts
 * viewEdges), so a view follows the graph and never stores an edge of its own.
 */
export const graphViews = sqliteTable('graph_views', {
  id: text('id').primaryKey(),
  projectId: projectId(),
  label: text('label').notNull(),
  nodeIds: json<string[]>('node_ids').notNull(),
  /** ai: picked by the chat from a request; manual: picked by a person from a selection. */
  origin: text('origin', { enum: ['ai', 'manual'] }).notNull().default('ai'),
  /** What the person asked the chat for (ai views). */
  request: text('request'),
  /** Why the chat kept each node, by node id (ai views). */
  reasons: json<Record<string, string>>('reasons').notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Where a model request came from: a workflow run (whole: one reading the whole script), a glossary fill, a model test, a chat turn or the editor. */
export const AI_CALL_KINDS = ['run', 'whole', 'terms', 'test', 'chat', 'editor'] as const;

/**
 * Every request sent to a model, one row per attempt (a fallback is its own row), written when it
 * goes out and finished when it returns: the app-wide log of AI work. Run steps keep the prompts.
 */
export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: id(),
    /** Null for calls outside a project (a model test). */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: AI_CALL_KINDS }).notNull(),
    /** The run, job or chat it belongs to; the connection for a model test. */
    refId: text('ref_id'),
    /** What it was for, as people read it ("AI 번역 · 60줄", "작품 분석 1/3"). */
    label: text('label').notNull(),
    /** The connection the request went through (a fallback's own, when it took over). */
    connectionId: text('connection_id'),
    connectionKind: text('connection_kind'),
    model: text('model'),
    status: text('status', { enum: ['running', 'ok', 'failed'] }).notNull().default('running'),
    error: text('error'),
    inputTokens: integer('input_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: real('cost_usd'),
    /** What was sent (system prompt and prompt), for glossary fills; runs keep theirs in run steps. */
    request: text('request'),
    /** What the call printed before it failed, for failed calls (the CLI's output or the partial text). */
    response: text('response'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('ai_calls_project_started').on(table.projectId, table.startedAt)],
);

export const terms = sqliteTable(
  'terms',
  {
    id: id(),
    projectId: projectId(),
    source: text('source').notNull(),
    target: text('target').notNull().default(''),
    note: text('note').notNull().default(''),
    /** Candidates (extracted by a workflow or the work analysis) are not used as context until a person confirms them; rejected ones are not proposed again. */
    status: text('status', { enum: KNOWLEDGE_STATUSES }).notNull().default('confirmed'),
    origin: text('origin', { enum: KNOWLEDGE_ORIGINS }).notNull().default('human'),
    /** Script lines whose source uses it (services/term-usage.ts); null until counted, again after its source changes. */
    lines: integer('lines'),
    /** Keys of the first lines that contain it, in script order. */
    examples: json<string[]>('examples').notNull().default(sql`'[]'`),
    /** The workflow run that added it, for AI terms. */
    runId: text('run_id'),
    /** Who put it in its current status (see knowledge()). */
    statusBy: text('status_by', { enum: STATUS_BY }).notNull().default('human'),
    updatedAt: updatedAt(),
  },
  // One term per source, whatever its case.
  (t) => [uniqueIndex('terms_source').on(t.projectId, sql`lower(${t.source})`)],
);

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
  /** The Korean written style (문체) a person chose for this character's lines; axes left out are 보통. */
  style: json<CharacterStyle>('style').notNull().default(sql`'{}'`),
  /** Gender and age band (GENDERS / AGE_BANDS in shared): 'unknown' until a person or the analysis knows. */
  gender: text('gender', { enum: GENDERS }).notNull().default('unknown'),
  ageBand: text('age_band', { enum: AGE_BANDS }).notNull().default('unknown'),
  /** How central the character is to the story. */
  role: text('role', { enum: CHARACTER_ROLES }).notNull().default('unknown'),
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
    startKey: text('start_key'),
    ...knowledge(),
    updatedAt: updatedAt(),
  },
  (t) => [index('speech_rules_pair').on(t.projectId, t.fromName, t.toName)],
);

/** "빈 번역 AI로 채우기" jobs on the glossary: kept so 실행 기록 lists them beside runs and analyses. */
export const termJobs = sqliteTable(
  'term_jobs',
  {
    id: id(),
    projectId: projectId(),
    connectionId: text('connection_id'),
    model: text('model'),
    effort: text('effort'),
    status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull(),
    done: integer('done').notNull().default(0),
    total: integer('total').notNull(),
    usage: json<{ inputTokens: number; outputTokens: number }>('usage'),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('term_jobs_project').on(t.projectId, t.createdAt)],
);

/** App-wide: connections are shared by every project. Secrets live in the OS keyring. */
export const connections = sqliteTable('connections', {
  id: id(),
  kind: text('kind', { enum: ['openai', 'systemone', 'codex', 'claude', 'grok', 'antigravity', 'opencode', 'http'] }).notNull(),
  name: text('name').notNull(),
  baseUrl: text('base_url'),
  executable: text('executable'),
  headerTemplate: text('header_template'),
  createdAt: createdAt(),
  /** Model calls this account takes at once, shared by every run. */
  concurrency: integer('concurrency').notNull().default(2),
  /** Filled in when the connection is picked somewhere; templates and imported workflows use it. */
  defaultModel: text('default_model'),
  defaultEffort: text('default_effort'),
  /** How every call through this connection is made, wherever it is picked. */
  maxAttempts: integer('max_attempts').notNull().default(2),
  /** Tokens a call may take in (the window) and give out; null = the model's own (from its model list, modelLimits). Output is also sent as each call's cap. */
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  /** Model id → its context window and output limit (from the model list, or a person's numbers); what "auto" budgets read. */
  modelLimits: json<Record<string, ModelLimits>>('model_limits').notNull().default(sql`'{}'`),
  /** Where calls go when this connection keeps failing transiently; that connection's own fallback is followed in turn. */
  fallback: json<ModelChoice>('fallback'),
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
  /** Lines carrying every one of these tags. */
  tagIds?: string[];
  /** Automatic marks (services/line-marks.ts): lines must have every one of them. */
  marks?: LineMark[];
  /** Specific status IDs to run on (overriding or supplementing entry node statusIds). */
  statusIds?: string[];
  /** Run the picked lines even if their status is not one the entry node accepts. */
  ignoreStatus?: boolean;
  /** Term workflows: these terms (instead of the entry node's statuses and marks). */
  termIds?: string[];
}
/** One connection + model a call can go to, frozen with the connection's details. */
export interface RouteSnapshot {
  connectionId: string;
  /** The connection's name when it was used, for display. */
  name: string;
  kind: string;
  baseUrl: string | null;
  executable: string | null;
  model: string;
  effort: string | null;
}
/**
 * A model choice as it was resolved when work started: the picked route first, then the
 * connection's fallbacks, with the picked connection's call settings.
 */
export interface AiSnapshot {
  /** "connection · model · effort", as people read it. */
  label: string;
  /** Unset: the model's own limit. */
  /** The connection's 출력 토큰, sent as each call's cap; unset = the model's own limit. */
  maxOutputTokens?: number;
  maxAttempts: number;
  routes: RouteSnapshot[];
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
    /** Every model the run's AI nodes picked, resolved, keyed by choiceKey. */
    models: json<Record<string, AiSnapshot>>('models').notNull().default(sql`'{}'`),
    /** What the run's items are (WORKFLOW_SUBJECTS): lines or terms. */
    subject: text('subject', { enum: WORKFLOW_SUBJECT_IDS as [WorkflowSubject, ...WorkflowSubject[]] }).notNull().default('lines'),
    scope: json<RunScope>('scope').notNull(),
    status: text('status', { enum: ['running', 'paused', 'cancelled', 'completed'] }).notNull(),
    total: integer('total').notNull(),
    /** Caps the person set when starting; the run pauses when one is reached. */
    limits: json<RunLimits>('limits'),
    /** Why the runner paused the run on its own (a guard, an error); cleared on resume. */
    notice: text('notice'),
    /** Each time a person continued the run with other models or re-queued its failed lines (#41), oldest first. */
    continuations: json<RunContinuation[]>('continuations').notNull().default(sql`'[]'`),
    createdAt: createdAt(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('runs_project').on(t.projectId, t.createdAt)],
);

export interface RunContinuation {
  at: number;
  /** AI steps switched to another model for the rest of the run: labels as the run detail shows them. */
  changes: { nodeId: string; from: string; to: string }[];
  /** Failed lines sent back to the queue. */
  retried: number;
}

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
  /** What the run did without changing the line (kept out of issues, which feed the revise prompt). */
  notes?: string[];
  /** Every node's output for this line, by node id. Conditions and later nodes read these. */
  outputs?: Record<string, Record<string, unknown>>;
  /** Nodes and exits taken, for display. */
  path: { nodeId: string; port: string; at: number }[];
  /** Times the line went back to a node's queue because a call failed transiently (rate limit, network), by node id. */
  retries?: Record<string, number>;
  /** The last failure that sent the line out through an "error" exit; cleared when a node handles it (ConditionData.error). */
  error?: { kind: ItemErrorKind; message: string; nodeId: string };
}

export const runItems = sqliteTable(
  'run_items',
  {
    id: id(),
    runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    /** The item: a line (units.id) or a term (terms.id), as the run's subject says. No foreign key: deleting one cancels its open items (see cancelSubjectItems). */
    subjectId: text('subject_id').notNull(),
    nodeId: text('node_id').notNull(),
    state: text('state', { enum: ['queued', 'running', 'done', 'failed', 'cancelled'] }).notNull(),
    visits: json<Record<string, number>>('visits').notNull(),
    data: json<ItemData>('data').notNull(),
    error: text('error'),
    /** The run plan's batch this line belongs to (see planRun); null for runs started before plans. */
    plan: integer('plan'),
    updatedAt: updatedAt(),
  },
  (t) => [index('run_items_run').on(t.runId, t.state, t.nodeId), index('run_items_subject').on(t.subjectId)],
);

export const runSteps = sqliteTable(
  'run_steps',
  {
    id: id(),
    runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    /** The items the call was for (lines or terms, as the run's subject says). */
    subjectIds: json<string[]>('subject_ids').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    /** The connection the call went out through: a node can share its work over several, and a fallback can take over. */
    connectionId: text('connection_id'),
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
    /** Items a per-item answer covered (non-empty); the request is `subjectIds`. */
    returnedItems: integer('returned_items'),
    /** 0 for a batch's first request, n for the n-th request for the lines it left out. */
    round: integer('round').notNull().default(0),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('run_steps_run').on(t.runId, t.startedAt)],
);

/**
 * A change an agent asked for outside the AI SDK approval flow (a CLI chat, the loca CLI). Nothing is
 * applied until a person accepts it in the chat panel; then the same tool runs with this input.
 */
/** Lines a batch proposal left out (errors, conflicts) and warnings about the ones it kept. */
export interface ProposalReport {
  dropped: { key: string; reason: string }[];
  warnings: { key: string; issues: string[] }[];
  counts?: { dropped: number; warnings: number };
}

export type ProposalStatus = 'pending' | 'running' | 'accepted' | 'rejected' | 'failed';
export type KnowledgeKind = 'characters' | 'relationships' | 'speechRules' | 'events' | 'documents';
export type UndoCall = {
  tool: string;
  input: Record<string, unknown>;
  expect?: { kind: KnowledgeKind | 'terms'; id: string; values: Record<string, unknown> }[];
};
/** Existing agent-tool calls that restore a proposal's previous values. */
export type ProposalUndo = { calls: UndoCall[]; lineRevs?: Record<string, number> } | { none: string };
export const proposals = sqliteTable(
  'proposals',
  {
    id: id(),
    projectId: projectId(),
    /** Chat session that produced it; null for changes sent from the CLI. */
    sessionId: text('session_id'),
    /** Model that proposed the change; null for person-originated proposals. */
    model: text('model'),
    source: text('source', { enum: ['cli', 'api', 'run'] }).notNull(),
    /** A workflow run's apply node filed it (source 'run'): the run and the node, so the list can group by run. */
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    nodeId: text('node_id'),
    tool: text('tool').notNull(),
    input: json<Record<string, unknown>>('input').notNull(),
    /** Inverse agent-tool calls, or why this change cannot be undone. */
    undo: json<ProposalUndo>('undo'),
    /** When this accepted change was undone through inverse proposals. */
    undoneAt: integer('undone_at', { mode: 'timestamp_ms' }),
    /** What the check at proposing time left out or warns about (see proposal-check.ts). */
    report: json<ProposalReport>('report'),
    /** running: accepted and its tool still applying (see decideProposal); never left so across a restart. */
    status: text('status', { enum: ['pending', 'running', 'accepted', 'rejected', 'failed'] }).notNull().default('pending'),
    result: json<unknown>('result'),
    createdAt: createdAt(),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    /** When the chat's agent was told the decision (once, whichever backend runs the next turn; #46). */
    reportedAt: integer('reported_at', { mode: 'timestamp_ms' }),
    /** Who decided (#45): the person on a card, or the conversation's permission mode (auto review / bypass). */
    decidedBy: text('decided_by', { enum: ['person', 'auto', 'bypass'] }),
    /** Why auto review held it for the person, or why it let it through. */
    review: text('review'),
    /** What the person said when rejecting it; the agent hears it with the decision. */
    reason: text('reason'),
  },
  (t) => [index('proposals_project').on(t.projectId, t.status)],
);

export const chatSessions = sqliteTable('chat_sessions', {
  id: id(),
  projectId: projectId(),
  title: text('title').notNull(),
  /** The AI this conversation talks to (picked in the composer). */
  connectionId: text('connection_id'),
  model: text('model'),
  effort: text('effort'),
  messages: json<unknown[]>('messages').notNull().default(sql`'[]'`),
  /** An agent CLI's own session for this chat (resumed each turn), and when it last took a turn. */
  /** The CLI's own session for this chat: a cache. `seen` = how many messages of the record it has been given (#46). */
  agentSession: json<{ kind: string; model: string; id: string; lastTurnAt: number; seen?: number }>('agent_session'),
  /** The conversation's start, summarized once the record outgrew the model's window: messages before `upTo` are in `summary` (chat-compaction.ts). */
  compaction: json<{ upTo: number; summary: string; at: number }>('compaction'),
  /** How the agent's changes are decided (#45): ask = a card each, auto = checked ones apply at once, bypass = all apply. */
  permissionMode: text('permission_mode', { enum: PERMISSION_MODES }).notNull().default('ask'),
  /** Messages sent while a turn was running that no turn has taken yet (#44); kept here so a restart does not lose them. */
  pendingSteers: json<string[]>('pending_steers').notNull().default(sql`'[]'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
