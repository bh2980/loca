import { z } from 'zod';
import { modelChoiceSchema } from './model-choice.ts';
import { modelLimitsSchema } from './budgets.ts';

export const CONNECTION_KINDS = ['openai', 'systemone', 'codex', 'claude', 'grok', 'antigravity', 'opencode', 'http'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/**
 * generate: structured generation (translate / revise / review nodes)
 * judge:    typed decision only (review nodes)
 * chat:     multi-turn conversation with the workbench tools (project chat agent). API connections call the
 *           tools natively; agent CLIs resume their own session each turn and request tools in their answer
 * tool:     an API key (credential) for the workflow "HTTP 호출" function; the address lives in the node
 */
export type Capability = 'generate' | 'judge' | 'chat' | 'tool';

export interface ConnectionKindInfo {
  label: string;
  transport: 'http' | 'cli';
  capabilities: Capability[];
  defaultBaseUrl?: string;
  needsKey: boolean;
  efforts: string[];
}

export const CONNECTION_KIND_INFO: Record<ConnectionKind, ConnectionKindInfo> = {
  openai: {
    label: 'OpenAI 호환 API',
    transport: 'http',
    capabilities: ['generate', 'chat'],
    defaultBaseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    efforts: ['minimal', 'low', 'medium', 'high'],
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
  /** Model calls this account takes at once, shared by every run. */
  /** Filled in when this connection is picked somewhere (and for templates and imported workflows). */
  defaultModel: z.string().trim().nullable().optional(),
  defaultEffort: z.string().nullable().optional(),
  /** How every call through this connection is made, wherever it is picked. (Time limits belong to what calls: an AI node's own, CALL_TIMEOUT_MS for the rest.) */
  maxAttempts: z.number().int().min(1).max(5).optional(),
  /** Tokens a call may take in (the window) and give out; null = the model's own. Output is also each call's cap. */
  inputTokens: z.number().int().min(1_000).max(10_000_000).nullable().optional(),
  outputTokens: z.number().int().min(256).max(1_000_000).nullable().optional(),
  /** What each model of this connection takes and gives in one call (model id → limits): from its model list, or a person's numbers. */
  modelLimits: z.record(z.string(), modelLimitsSchema).optional(),
  /** Where calls go when this connection keeps failing transiently (rate limit, network, timeout); that connection's own fallback is followed in turn. */
  fallback: modelChoiceSchema.nullable().optional(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

/** Defaults of a new connection's call settings. */
export const CONNECTION_CALL_DEFAULTS = { maxAttempts: 2 } as const;

/**
 * Time limits of calls that have no settings of their own (a workflow node and the editor's AI set
 * theirs): how long a call may take depends on the work, not on the connection. A chat turn has no
 * overall limit: it stops when the model goes quiet for `chatIdle` (or on 중단).
 */
export const CALL_TIMEOUT_MS = { connectionTest: 120_000, chatIdle: 120_000 } as const;
