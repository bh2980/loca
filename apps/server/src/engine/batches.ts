import { batchTokens, lineCost, type BatchConfig } from '@tw/shared';

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
 * - "group": consecutive scenes share a request up to `maxTokens`, each line counted by `lineCost`
 *   (its text plus what a line costs the request), so many short lines are bounded too.
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
  if (config.mode === 'whole') return wholeScript([...Map.groupBy(ordered, (line) => line.groupId).values()], batchTokens(config));
  if (config.mode === 'count') return byKind(ordered).flatMap((run) => Array.from({ length: Math.ceil(run.length / config.size) }, (_, index) => run.slice(index * config.size, (index + 1) * config.size)));

  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  const flush = () => {
    if (current.length) batches.push(current);
    current = [];
    tokens = 0;
  };
  const fits = (more: number) => current.length === 0 || tokens + more <= batchTokens(config);
  const halfFull = () => tokens * 2 >= batchTokens(config);
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
    const sceneTokens = scene.reduce((sum, line) => sum + lineCost(line), 0);
    if (unrelated(scene)) flush();
    if (fits(sceneTokens)) {
      current.push(...scene);
      tokens += sceneTokens;
      continue;
    }
    const wholeFits = sceneTokens <= batchTokens(config);
    flush();
    if (wholeFits) {
      current.push(...scene);
      tokens += sceneTokens;
      continue;
    }
    // Larger than one request: cut it, line by line, at the limits.
    for (const line of scene) {
      if (!fits(lineCost(line))) flush();
      current.push(line);
      tokens += lineCost(line);
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
  if (config.mode === 'whole') return wholeScript(planned, batchTokens(config));
  // A group that holds several kinds (a mixed imported group, an older plan) is cut where the kind changes.
  const groups = planned.flatMap(byKind);
  const requests: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  // "count" packs by its line count; "group" by tokens only (lineCost per line).
  const limitTokens = config.mode === 'group' ? batchTokens(config) : Infinity;
  const limitLines = config.mode === 'count' ? config.size : Infinity;
  const flush = () => {
    if (current.length) requests.push(current);
    current = [];
    tokens = 0;
  };
  // A small remnant (lines an answer left out, a review's few failures) may ride with a neighbour
  // a little past the limits rather than cost a request of its own.
  const small = (count: number, cost: number) => (config.mode === 'count' ? count * 4 <= limitLines : cost * 4 <= limitTokens);
  for (const group of groups) {
    const groupTokens = group.reduce((sum, line) => sum + lineCost(line), 0);
    const slack = small(group.length, groupTokens) || small(current.length, tokens) ? 1.25 : 1;
    if (current.length && group[0]?.kind !== undefined && group[0].kind !== current[0]!.kind) flush();
    if (current.length && (current.length + group.length > limitLines * slack || tokens + groupTokens > limitTokens * slack)) flush();
    if (group.length <= limitLines && groupTokens <= limitTokens) {
      current.push(...group);
      tokens += groupTokens;
      continue;
    }
    for (const line of group) {
      if (current.length && (current.length + 1 > limitLines || tokens + lineCost(line) > limitTokens)) flush();
      current.push(line);
      tokens += lineCost(line);
    }
  }
  flush();
  return requests;
}

/**
 * "whole": the script in as few requests as `maxTokens` allows, whatever the line
 * count or kind. Groups (scenes, or plan batches) are never cut unless one alone is larger than a
 * request; a model that refuses a request as too long gets it again in halves (the runner).
 */
function wholeScript<T extends { tokens: number }>(groups: T[][], maxTokens: number): T[][] {
  const requests: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  for (const group of groups) {
    const groupTokens = group.reduce((sum, line) => sum + lineCost(line), 0);
    if (current.length && tokens + groupTokens > maxTokens) {
      requests.push(current);
      current = [];
      tokens = 0;
    }
    if (groupTokens <= maxTokens) {
      current.push(...group);
      tokens += groupTokens;
      continue;
    }
    for (const line of group) {
      if (current.length && tokens + lineCost(line) > maxTokens) {
        requests.push(current);
        current = [];
        tokens = 0;
      }
      current.push(line);
      tokens += lineCost(line);
    }
  }
  if (current.length) requests.push(current);
  return requests;
}
