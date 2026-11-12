import { z } from 'zod';
import { modelLimitsSchema } from './budgets.ts';

/** The agent CLIs a connection can run: the kinds whose transport is `cli` (CONNECTION_KIND_INFO is typed by this list). */
export const CLI_KINDS = ['codex', 'claude', 'grok', 'antigravity', 'opencode'] as const;
export type CliKind = (typeof CLI_KINDS)[number];
export const isCliKind = (kind: string): kind is CliKind => (CLI_KINDS as readonly string[]).includes(kind);

export const CONNECTION_KINDS = ['openai', 'systemone', ...CLI_KINDS, 'http'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const isConnectionKind = (kind: string): kind is ConnectionKind => (CONNECTION_KINDS as readonly string[]).includes(kind);

/**
 * generate: structured generation (translate / revise / review nodes)
 * judge:    typed decision only (review nodes)
 * chat:     multi-turn conversation with the workbench tools (project chat agent). API connections call the
 *           tools natively; agent CLIs resume their own session each turn and request tools in their answer
 * complete: plain text fast enough to follow typing (the editor's autocomplete); a CLI takes seconds per call
 * tool:     an API key (credential) for the workflow "HTTP 호출" function; the address lives in the node
 *
 * What a kind can do is listed here; how it does it is its provider in @loca/ai (PROVIDERS), and a test there
 * keeps the two from disagreeing.
 */
export const CAPABILITIES = ['generate', 'judge', 'chat', 'complete', 'tool'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface ConnectionKindInfo {
  label: string;
  transport: 'http' | 'cli';
  capabilities: Capability[];
  defaultBaseUrl?: string;
  needsKey: boolean;
  efforts: string[];
  /** Its generation takes a sampling temperature (an AI node's 온도); a CLI and a judgment model have no such setting. */
  temperature?: boolean;
}

export const CONNECTION_KIND_INFO: { [K in ConnectionKind]: ConnectionKindInfo & { transport: K extends CliKind ? 'cli' : 'http' } } = {
  openai: {
    label: 'OpenAI 호환 API',
    transport: 'http',
    capabilities: ['generate', 'chat', 'complete'],
    defaultBaseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    efforts: ['minimal', 'low', 'medium', 'high'],
    temperature: true,
  },
  systemone: {
    label: 'System One (TypeSafe)',
    transport: 'http',
    capabilities: ['judge'],
    defaultBaseUrl: 'https://api.typesafe.ai',
    needsKey: true,
    efforts: [],
  },
  codex: { label: 'Codex CLI', transport: 'cli', capabilities: ['generate', 'chat'], needsKey: false, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  claude: { label: 'Claude Code CLI', transport: 'cli', capabilities: ['generate', 'chat'], needsKey: false, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  // grok 4.x: --reasoning-effort low|medium|high|xhigh (its own default is high).
  grok: { label: 'Grok CLI', transport: 'cli', capabilities: ['generate', 'chat'], needsKey: false, efforts: ['low', 'medium', 'high', 'xhigh'] },
  // agy names the effort in the model id (gemini-3.8-flash-high / -medium / -low): picked with the model.
  antigravity: { label: 'Antigravity CLI', transport: 'cli', capabilities: ['generate', 'chat'], needsKey: false, efforts: [] },
  // opencode's own free models (opencode/…) are only served through its CLI; opencode Go models too.
  opencode: { label: 'opencode CLI', transport: 'cli', capabilities: ['generate', 'chat'], needsKey: false, efforts: [] },
  http: { label: 'API 키', transport: 'http', capabilities: ['tool'], needsKey: true, efforts: [] },
};

/** Whether connections of this kind can do `capability`: the question callers ask instead of naming a kind. */
export const connectionCan = (kind: ConnectionKind, capability: Capability) => CONNECTION_KIND_INFO[kind].capabilities.includes(capability);

/** opencode's own free models without the "-free" suffix (`opencode models --verbose` lists their cost as 0). */
const OPENCODE_FREE_MODELS = new Set(['opencode/big-pickle']);

/**
 * Whether a model costs nothing: an opencode CLI model whose id ends in "-free" (e.g.
 * opencode/beam-free) or one of its other zero-cost built-ins (opencode/big-pickle).
 * The preflight cost estimate and the UI "무료" badge both use this one rule.
 */
export function isFreeModel(kind: string, model: string | null | undefined): boolean {
  return kind === 'opencode' && Boolean(model && (model.endsWith('-free') || OPENCODE_FREE_MODELS.has(model)));
}

export const connectionInputSchema = z.object({
  kind: z.enum(CONNECTION_KINDS),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url().optional(),
  /** Absolute path to the CLI executable. Empty = resolve from PATH. */
  executable: z.string().trim().optional(),
  /** HTTP tools: how the stored key is sent, e.g. "Authorization: Bearer {key}" or "X-API-Key: {key}". */
  headerTemplate: z.string().trim().optional(),
  /** What each model of this connection takes and gives in one call (model id → limits): from its model list, or a person's numbers. */
  modelLimits: z.record(z.string(), modelLimitsSchema).optional(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

/**
 * Time limits of calls that have no settings of their own (a workflow node and the editor's AI set
 * theirs): how long a call may take depends on the work, not on the connection. A chat turn has no
 * overall limit: it stops when the model goes quiet for `chatIdle` (or on 중단).
 */
export const CALL_TIMEOUT_MS = { connectionTest: 120_000, chatIdle: 120_000 } as const;
