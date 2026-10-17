import type * as ai from '@tw/ai';

export interface ModelPort {
  generate: typeof ai.generate;
  judge: typeof ai.judge;
}
