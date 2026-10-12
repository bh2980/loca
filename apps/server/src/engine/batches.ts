import type { BatchConfig } from '@tw/shared';

/** A line to batch, in script position. `tokens` is the estimated size of its text. */
export interface BatchLine {
  groupId: string;
  groupSort: number;
  sort: number;
  tokens: number;
}

/**
 * Lines split into model requests, in script order (scene order, then line order). This is the
 * one batching rule: the runner, the context preview and the run plan all call it.
 *
 * - "unit": one line per request.
 * - "count": `size` lines per request, ignoring scene boundaries.
 * - "group": consecutive scenes share a request up to `size` lines and `maxTokens` of line text.
 *   A scene starts a new request instead of being split, unless it is larger than a whole request
 *   on its own; then it is cut into full requests and its tail keeps filling. Short scenes no longer
 *   cost a request each; the prompt keeps every scene's boundary and per-line context.
 */
export function planBatches<T extends BatchLine>(lines: T[], config: BatchConfig): T[][] {
  const ordered = [...lines].sort((a, b) => a.groupSort - b.groupSort || a.groupId.localeCompare(b.groupId) || a.sort - b.sort);
  if (config.mode === 'unit') return ordered.map((line) => [line]);
  if (config.mode === 'count') return Array.from({ length: Math.ceil(ordered.length / config.size) }, (_, index) => ordered.slice(index * config.size, (index + 1) * config.size));

  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  const flush = () => {
    if (current.length) batches.push(current);
    current = [];
    tokens = 0;
  };
  const fits = (count: number, more: number) => current.length + count <= config.size && (current.length === 0 || tokens + more <= config.maxTokens);
  const scenes = [...Map.groupBy(ordered, (line) => line.groupId).values()];
  for (const scene of scenes) {
    const sceneTokens = scene.reduce((sum, line) => sum + line.tokens, 0);
    if (fits(scene.length, sceneTokens)) {
      current.push(...scene);
      tokens += sceneTokens;
      continue;
    }
    const wholeFits = scene.length <= config.size && sceneTokens <= config.maxTokens;
    flush();
    if (wholeFits) {
      current.push(...scene);
      tokens += sceneTokens;
      continue;
    }
    // Larger than one request: cut it, line by line, at the limits.
    for (const line of scene) {
      if (!fits(1, line.tokens)) flush();
      current.push(line);
      tokens += line.tokens;
    }
  }
  flush();
  return batches;
}
