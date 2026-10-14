import type { BatchConfig } from '@tw/shared';

/** A line to batch, in script position. `tokens` is the estimated size of its text. */
export interface BatchLine {
  groupId: string;
  /** Position in the whole script (units.seq). */
  seq: number;
  tokens: number;
  /** Dialogue, document or UI text; set when planning a run so they are not mixed. */
  kind?: string;
  speaker?: string | null;
}

/** Consecutive lines of one kind (dialogue, document, UI); lines without a known kind stay with their neighbours. */
function byKind<T extends { kind?: string }>(lines: T[]): T[][] {
  const runs: T[][] = [];
  for (const line of lines) {
    const last = runs.at(-1);
    if (last && (line.kind === undefined || last[0]!.kind === undefined || last[0]!.kind === line.kind)) last.push(line);
    else runs.push([line]);
  }
  return runs;
}

/**
 * Lines split into model requests, in script order. This is the one batching rule: the run plan,
 * the runner and the context preview all call it.
 *
 * - "unit": one line per request.
 * - "count": `size` lines per request, ignoring scene boundaries.
 * - "group": consecutive scenes share a request up to `size` lines and `maxTokens` of line text.
 *   A scene starts a new request instead of being split, unless it is larger than a whole request
 *   on its own; then it is cut into full requests and its tail keeps filling. With `kind` and
 *   `speaker` known (the run plan), a scene also starts a new request when its kind differs
 *   (dialogue, document, UI) or when it shares no speaker with a request already half full and no
 *   `linked` scene (a direct dialogue-graph transition): related scenes travel together, unrelated
 *   ones do not pad each other's context.
 */
export function planBatches<T extends BatchLine>(lines: T[], config: BatchConfig, linked?: (a: string, b: string) => boolean): T[][] {
  const ordered = [...lines].sort((a, b) => a.seq - b.seq);
  if (config.mode === 'unit') return ordered.map((line) => [line]);
  if (config.mode === 'count') return byKind(ordered).flatMap((run) => Array.from({ length: Math.ceil(run.length / config.size) }, (_, index) => run.slice(index * config.size, (index + 1) * config.size)));

  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  const flush = () => {
    if (current.length) batches.push(current);
    current = [];
    tokens = 0;
  };
  const fits = (count: number, more: number) => current.length + count <= config.size && (current.length === 0 || tokens + more <= config.maxTokens);
  const halfFull = () => current.length * 2 >= config.size || tokens * 2 >= config.maxTokens;
  const unrelated = (scene: T[]) => {
    if (!current.length) return false;
    if (scene[0].kind !== undefined && scene[0].kind !== current[0].kind) return true;
    const speakers = new Set(current.flatMap((line) => (line.speaker ? [line.speaker] : [])));
    const theirs = scene.flatMap((line) => (line.speaker ? [line.speaker] : []));
    if (!(speakers.size > 0 && theirs.length > 0 && !theirs.some((speaker) => speakers.has(speaker)) && halfFull())) return false;
    const groups = new Set(current.map((line) => line.groupId));
    return !linked || ![...groups].some((group) => linked(group, scene[0].groupId) || linked(scene[0].groupId, group));
  };
  const scenes = [...Map.groupBy(ordered, (line) => line.groupId).values()];
  for (const scene of scenes) {
    const sceneTokens = scene.reduce((sum, line) => sum + line.tokens, 0);
    if (unrelated(scene)) flush();
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

/**
 * Groups that must stay together (the run plan's batches, in plan order) packed into requests: whole
 * groups share a request up to the node's limits; a group larger than one request is cut. Groups of
 * another kind (dialogue, document, UI: their first line's `kind`, when known) start a new request,
 * as they do in planBatches.
 */
export function packGroups<T extends { tokens: number; kind?: string }>(planned: T[][], config: BatchConfig): T[][] {
  if (config.mode === 'unit') return planned.flat().map((line) => [line]);
  // A group that holds several kinds (a mixed imported group, an older plan) is cut where the kind changes.
  const groups = planned.flatMap(byKind);
  const requests: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  const limitTokens = config.mode === 'group' ? config.maxTokens : Infinity;
  const flush = () => {
    if (current.length) requests.push(current);
    current = [];
    tokens = 0;
  };
  // A small remnant (lines an answer left out, a review's few failures) may ride with a neighbour
  // a little past the limits rather than cost a request of its own.
  const small = (count: number) => count * 4 <= config.size;
  for (const group of groups) {
    const groupTokens = group.reduce((sum, line) => sum + line.tokens, 0);
    const slack = small(group.length) || small(current.length) ? 1.25 : 1;
    if (current.length && group[0]?.kind !== undefined && group[0].kind !== current[0]!.kind) flush();
    if (current.length && (current.length + group.length > config.size * slack || tokens + groupTokens > limitTokens * slack)) flush();
    if (group.length <= config.size && groupTokens <= limitTokens) {
      current.push(...group);
      tokens += groupTokens;
      continue;
    }
    for (const line of group) {
      if (current.length && (current.length + 1 > config.size || tokens + line.tokens > limitTokens)) flush();
      current.push(line);
      tokens += line.tokens;
    }
  }
  flush();
  return requests;
}
