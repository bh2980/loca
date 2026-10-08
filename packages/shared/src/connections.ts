import { z } from 'zod';

export const CONNECTION_KINDS = ['openai', 'systemone', 'codex', 'claude', 'grok', 'antigravity', 'http'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/**
 * generate: structured generation (translate / revise / review nodes)
 * judge:    typed decision only (review nodes)
 * chat:     tool-calling conversation (project chat agent)
 * tool:     plain HTTP API called by the workflow "HTTP 호출" function (spell checkers, dictionaries…)
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
    defaultBaseUrl: 'https://api.typesafe.ai/v1',
    needsKey: true,
    efforts: [],
  },
  codex: { label: 'Codex CLI', transport: 'cli', capabilities: ['generate'], needsKey: false, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  claude: { label: 'Claude Code CLI', transport: 'cli', capabilities: ['generate'], needsKey: false, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  grok: { label: 'Grok CLI', transport: 'cli', capabilities: ['generate'], needsKey: false, efforts: [] },
  antigravity: { label: 'Antigravity CLI', transport: 'cli', capabilities: ['generate'], needsKey: false, efforts: [] },
  http: { label: 'HTTP API (도구)', transport: 'http', capabilities: ['tool'], needsKey: false, efforts: [] },
};

export const connectionInputSchema = z.object({
  kind: z.enum(CONNECTION_KINDS),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url().optional(),
  /** Absolute path to the CLI executable. Empty = resolve from PATH. */
  executable: z.string().trim().optional(),
  /** HTTP tools: how the stored key is sent, e.g. "Authorization: Bearer {key}" or "X-API-Key: {key}". */
  headerTemplate: z.string().trim().optional(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

const route = z.object({
  connectionId: z.string().min(1),
  model: z.string().trim().min(1),
  effort: z.string().optional(),
});

export const profileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().default(''),
  connectionId: z.string().min(1),
  model: z.string().trim().min(1),
  effort: z.string().optional(),
  instructions: z.string().default(''),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(256).max(200_000).default(8000),
  timeoutSeconds: z.number().int().min(10).max(3600).default(300),
  maxAttempts: z.number().int().min(1).max(5).default(2),
  /** Tried in order after the primary route exhausts its attempts on a transient failure. */
  fallbacks: z.array(route).max(3).default([]),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;
