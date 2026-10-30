import type * as ai from '@tw/ai';

export interface ModelPort {
  generate: typeof ai.generate;
  /** Typed questions for a connection that judges instead of writing. */
  ask: typeof ai.ask;
}
