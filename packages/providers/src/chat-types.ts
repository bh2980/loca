import type { ModelRoute } from '@workbench/contracts';
import type { ProviderConnection, ProviderUsage } from './types.js';

export interface ChatToolCall {
  /** The provider's call ID, preserved exactly for subsequent tool results. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatToolDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export type ChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ChatToolCall[]; responseItems?: Record<string, unknown>[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatRequest {
  connection: ProviderConnection;
  profile: ModelRoute;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  /** Memory-only secret. Only this credential or the explicitly configured envKey is used. */
  credential?: string;
  signal?: AbortSignal;
  stream?: boolean;
  /** Cumulative bounded text only; tool arguments are never exposed while incomplete. */
  onText?: (text: string) => void;
}

export interface ChatResult {
  message: string;
  toolCalls: ChatToolCall[];
  usage?: ProviderUsage;
  reportedModel?: string;
  /** Replay these on the assistant message when using Responses, including encrypted reasoning. */
  responseItems?: Record<string, unknown>[];
}

export interface ChatCapability {
  /** Adapter implemented; this does not prove the remote endpoint/model supports tools. */
  supported: boolean;
  protocol?: 'chat' | 'responses';
  streaming: boolean;
  detail: string;
}

/** For deterministic fake HTTP tests; production uses the runtime's fetch. */
export interface ChatDependencies { fetch?: typeof globalThis.fetch }
