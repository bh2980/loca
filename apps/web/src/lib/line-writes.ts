import { createOptimisticAction } from '@tanstack/react-db';
import { useMutation } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import type { LineTranslate } from '@tw/shared';
import { client } from './api';
import { sent } from './collections';
import { pickedNow } from './line-picks';
import { extrasOf, unitsOf, type Line } from './units';
import { writeQueue } from './write-queue';

/**
 * Every write to a line, in one place. Each shows on the held rows at once, goes to the server, and is done when
 * the row feed has brought the saved rows back (its x-seq, then the rows read again); a refusal puts the rows back
 * and rejects, for the caller's message.
 *
 * Writes to the same line go one after another (lib/write-queue.ts): a line's rev moves with every write to it, so a
 * save sent while the memo before it is still on its way would carry the rev from before the memo and be refused as
 * stale. The second write waits for the first's answer and reads the rev then.
 */
type Api = (typeof client.projects)[':projectId'];
const queue = writeQueue();

/**
 * The rev the last answer about a line brought, with the held row's rev at that moment: used while the held row is
 * still that one (the feed has not brought the new row yet, or its wait gave up), and forgotten once the row moves.
 */
const answered = new Map<string, { rev: number; over: number | undefined }>();
const heldRev = (projectId: string, unitId: string) => {
  const row = unitsOf(projectId).collection.get(unitId);
  return row ? new Date(row.updatedAt).getTime() : undefined;
};

/**
 * A line's rev as the browser knows it: what a write made from this view of the line sends, so the server refuses to
 * write over a change that has not reached this browser. Undefined for a line it does not hold.
 */
export function lineRev(projectId: string, unitId: string): number | undefined {
  const held = heldRev(projectId, unitId);
  const last = answered.get(unitId);
  if (last && last.over === held) return last.rev;
  if (last) answered.delete(unitId);
  return held;
}
const noteRev = (projectId: string, unitId: string, rev: number) => void answered.set(unitId, { rev, over: heldRev(projectId, unitId) });

type Shown = { statusId?: string; listener?: string | null; tagIds?: string[]; translation?: string; addTagIds?: string[]; removeTagIds?: string[]; checked?: true; note?: string; translate?: LineTranslate | null };

/** What a line write looks like on the line before the server echoes it. */
function shownOn(json: Shown) {
  return (row: Line): Partial<Line> => ({
    ...(json.statusId !== undefined && { statusId: json.statusId }),
    // A person's status or translation (or 확인함) makes the status theirs: the ✦ goes.
    ...((json.statusId !== undefined || json.translation !== undefined || json.checked) && { statusBy: 'human' as const, statusRunId: null }),
    ...(json.listener !== undefined && { listener: json.listener, listenerOrigin: 'human' as const, listenerConfidence: null }),
    ...(json.translation !== undefined && { translation: json.translation, origin: 'human' as const, model: null }),
    ...(json.tagIds !== undefined && { tagIds: json.tagIds }),
    ...(json.note !== undefined && { note: json.note.trim() }),
    ...(json.translate !== undefined && { translate: json.translate }),
    ...((json.addTagIds || json.removeTagIds) && { tagIds: [...new Set([...row.tagIds.filter((id) => !json.removeTagIds?.includes(id)), ...(json.addTagIds ?? [])])] }),
  });
}

/**
 * The one path a line write takes: the held lines change at once; when every earlier write to these lines has its
 * answer, `send` makes the request (so it reads the revs as they are then); the write is done once the feed has
 * brought the rows back.
 */
function writeLines<T extends Response & { json(): Promise<unknown> }>(projectId: string, ids: Iterable<string>, shown: Shown, send: () => Promise<T>) {
  const { collection } = unitsOf(projectId);
  const targets = [...new Set(ids)];
  const change = shownOn(shown);
  let body: Awaited<ReturnType<T['json']>> | undefined;
  const run = createOptimisticAction<void>({
    onMutate: () => {
      for (const id of targets) if (collection.has(id)) collection.update(id, (draft) => void Object.assign(draft, change(draft as Line)));
    },
    mutationFn: () =>
      queue.run(targets, async () => {
        body = await sent(projectId, send());
        // The feed named the lines; they are read again before the change counts as done (no flash of the old row).
        await unitsOf(projectId).idle();
      }),
  });
  return run().when('settled').then(() => body as Awaited<ReturnType<T['json']>>);
}

/** What else a person sets on one line: its tags (whole), listener, memo, 번역 제외. */
export type LinePatch = { tagIds?: string[]; listener?: string | null; note?: string; translate?: LineTranslate | null };

export function patchLine(projectId: string, unitId: string, json: LinePatch) {
  return writeLines(projectId, [unitId], json, async () => {
    const response = await client.units[':unitId'].$patch({ param: { unitId }, json });
    if (response.ok) noteRev(projectId, unitId, ((await response.clone().json()) as { rev: number }).rev);
    return response;
  });
}

/** One save of a line's text and/or status (server: POST /units/:unitId/save, services/line-save.ts). */
export interface LineSaveInput {
  unitId: string;
  text?: string;
  candidateId?: string;
  /** The candidate's text, so the line shows it at once when a candidate is picked. */
  candidateText?: string;
  statusId?: string;
  /** 내 수정 유지: the person kept their text over a change made meanwhile, and the line's history says so. */
  keepMine?: boolean;
}

/**
 * The single path that writes a line's text or status; the server writes text, candidate and status together, so no
 * screen keeps its own variant of this save. Every save carries the line's rev as this browser knows it: a line
 * changed since (a run, another window) is not written over.
 */
export function saveLine(projectId: string, { unitId, candidateText, ...json }: LineSaveInput) {
  const translation = json.text ?? candidateText;
  return writeLines(projectId, [unitId], { ...(translation !== undefined && { translation }), ...(json.statusId && { statusId: json.statusId }) }, async () => {
    const rev = lineRev(projectId, unitId);
    const response = await client.units[':unitId'].save.$post({ param: { unitId }, json: { ...json, ...(rev !== undefined && { rev }) } });
    if (response.ok) noteRev(projectId, unitId, ((await response.clone().json()) as { rev: number }).rev);
    return response;
  });
}

/** What a bulk change sets on picked lines: a status, 확인함, a tag on or off, the listener, 번역 제외. */
export type PickedPatch = { statusId: string } | { checked: true } | { addTagIds: string[] } | { removeTagIds: string[] } | { listener: string | null } | { translate: LineTranslate };

/**
 * A change to many picked lines at once. One that decides the lines' state (a status, 확인함) is made from a view of
 * them, so it carries what this browser knows of each: the held lines' revs, and for the ones it does not hold the
 * `asOf` of the bar's answer about them (lib/line-picks.ts); a line changed since is left as it is and counted
 * (`skipped`). A tag, the listener or 번역 제외 goes on whatever the line holds now.
 * It waits for every earlier write to these lines, and the next one waits for this: sent back to back, the second
 * would carry revs from before the first.
 */
export function patchPickedLines(projectId: string, unitIds: readonly string[], json: PickedPatch) {
  const decides = 'statusId' in json || 'checked' in json;
  return writeLines(projectId, unitIds, json, async () => {
    if (!decides) return client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...unitIds], ...json } });
    const { collection } = unitsOf(projectId);
    const revs: Record<string, number> = {};
    const away: string[] = [];
    for (const id of unitIds) {
      const rev = collection.has(id) ? lineRev(projectId, id) : undefined;
      if (rev === undefined) away.push(id);
      else revs[id] = rev;
    }
    const asOf = away.length ? (await pickedNow(projectId, away)).asOf : undefined;
    return client.projects[':projectId'].units.$patch({ param: { projectId }, json: { unitIds: [...unitIds], ...json, revs, ...(asOf !== undefined && { asOf }) } });
  });
}

/**
 * One translation for other lines with the same source (the editor's '모두 이 번역으로'), each at the rev it was
 * shown with: a line changed since is skipped and counted.
 */
export function applySameSource(projectId: string, unitId: string, text: string, lines: { unitId: string; rev: number }[]) {
  return writeLines(projectId, lines.map((line) => line.unitId), { translation: text }, () => client.units[':unitId']['same-source'].$post({ param: { unitId }, json: { text, lines } }));
}

/** 거절: a waiting AI 제안 is turned down (it stays in the line's history). Done once the line and its candidates are read again. */
export async function declineSuggestion(projectId: string, unitId: string, candidateId: string) {
  await queue.run([unitId], async () => {
    await sent(projectId, client.units[':unitId'].candidates[':candidateId'].decline.$post({ param: { unitId, candidateId } }));
    await Promise.all([unitsOf(projectId).idle(), extrasOf(projectId).idle()]);
  });
}

// ── the script's structure: lines and their groups ────────────────────────────

export type LineCreate = InferRequestType<Api['units']['$post']>['json'];
export type LineSourcePatch = InferRequestType<Api['units'][':unitId']['source']['$patch']>['json'];

/** A new source line in a group. */
export const createLine = (projectId: string, json: LineCreate) => sent(projectId, client.projects[':projectId'].units.$post({ param: { projectId }, json }));

/** A line's source text, key, speaker or listener as written in the script (its translation has its own save). */
export const editLineSource = (projectId: string, unitId: string, json: LineSourcePatch) =>
  queue.run([unitId], () => sent(projectId, client.projects[':projectId'].units[':unitId'].source.$patch({ param: { projectId, unitId }, json })));

/** Deletes a line; the answer's token takes it back (lib/undo.ts). */
export const deleteLine = (projectId: string, unitId: string) => queue.run([unitId], () => sent(projectId, client.projects[':projectId'].units[':unitId'].$delete({ param: { projectId, unitId } })));

/** saveLine as a mutation, for the screens that show its pending state. */
export function useSaveLine(projectId: string) {
  return useMutation({ mutationFn: (input: LineSaveInput) => saveLine(projectId, input) });
}
