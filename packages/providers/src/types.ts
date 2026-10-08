import type { Connection, ExecutionProfile } from '@workbench/contracts';
export type ProviderKind = Exclude<Connection['kind'], 'mock'>;

/** No credential values are persisted. envKey names a worker environment variable. */
export interface ProviderConnection extends Connection {
  structuredOutput?: 'json-schema' | 'json-object' | 'text';
  tokenLimitField?: 'max_completion_tokens' | 'max_tokens';
}

export interface ProviderProfile extends ExecutionProfile {
  /** Legacy client hint. Never treated as authoritative model metadata. */
  supportedEfforts?: string[];
}

export type EffortSupport = 'known' | 'unsupported' | 'unknown';
export interface CatalogModel {
  id: string;
  name: string;
  efforts: string[];
  effortSupport: EffortSupport;
}
export interface ModelCatalog {
  models: CatalogModel[];
  source: 'cli' | 'api' | 'manual';
  checkedAt: string;
  cliVersion?: string;
  modelListStatus: 'available' | 'unsupported' | 'unavailable';
  /** Only a complete authoritative list can prove an ID is absent. */
  complete: boolean;
  detail?: string;
}
export interface ModelProfileValidation { status: 'verified' | 'unverified'; detail: string }

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface ProviderRequest {
  connection: ProviderConnection;
  profile: ProviderProfile;
  prompt: string;
  schema: Record<string, unknown>;
  /** Structured stage context for evaluators that do not generate free text. */
  context?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Memory-only credential supplied by the worker's secret store. Never persist/log this request. */
  credential?: string;
  /** Intentionally not exposed as the CLI cwd. Each call uses a disposable isolated directory. */
  workspaceDir?: string;
}

export type AuthMethod = 'browser' | 'device-code' | 'terminal';
export interface AuthState {
  connectionId: string;
  state: 'unknown' | 'signed-out' | 'signed-in' | 'pending' | 'failed' | 'unavailable';
  accountLabel?: string;
  detail: string;
  checkedAt: string;
  methods: AuthMethod[];
}
export interface AuthAttempt {
  id: string;
  connectionId: string;
  state: 'starting' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
  message: string;
}
export interface LoginOptions {
  method: 'browser' | 'device-code';
  onUpdate: (attempt: AuthAttempt) => void;
  signal?: AbortSignal;
  attemptId: string;
}

export interface ProviderResult {
  data: unknown;
  usage?: ProviderUsage;
  reportedModel?: string;
  reportedEffort?: string;
  diagnostics?: string;
}

export interface ConnectionInspection {
  available: boolean;
  version?: string;
  detail: string;
  efforts?: string[];
}

export class ProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}
