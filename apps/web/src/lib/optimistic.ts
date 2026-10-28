import type { QueryClient, QueryKey } from '@tanstack/react-query';

type Change = { key: QueryKey; update: (data: never) => unknown };

/**
 * Shows a change in every cached query it touches before the server answers, and returns how to
 * refetch them if it fails, without restoring a stale snapshot over concurrent saves.
 */
export async function optimistic(queryClient: QueryClient, changes: Change[]) {
  await Promise.all(changes.map((change) => queryClient.cancelQueries({ queryKey: change.key })));
  for (const change of changes) queryClient.setQueriesData({ queryKey: change.key }, (data: unknown) => (data === undefined ? data : change.update(data as never)));
  return () => {
    // Refetch authoritative values; an old list snapshot can erase another successful save.
    for (const change of changes) void queryClient.invalidateQueries({ queryKey: change.key });
  };
}

type Row = { id: string } & Record<string, unknown>;
/** The same change to some lines wherever they are cached: their details and every line list. */
export function unitChanges(ids: Iterable<string>, change: (row: Row) => Row): Change[] {
  const set = new Set(ids);
  return [
    ...[...set].map((id) => ({ key: ['units', 'detail', id], update: (row: Row) => change(row) })),
    { key: ['units', 'list'], update: (data: { rows: Row[] }) => ({ ...data, rows: data.rows.map((row) => (set.has(row.id) ? change(row) : row)) }) },
    // The path view's translation list holds the same rows in chunks.
    { key: ['units', 'route-rows'], update: (data: { rows: Row[] }) => ({ ...data, rows: data.rows.map((row) => (set.has(row.id) ? change(row) : row)) }) },
  ];
}

/** What a line patch looks like on the line before the server echoes it. */
export function patchedLine(json: { statusId?: string; listener?: string | null; tagIds?: string[]; translation?: string; addTagIds?: string[]; removeTagIds?: string[]; checked?: true; note?: string; translate?: 'include' | 'exclude' | null }) {
  return (row: Row): Row => ({
    ...row,
    ...(json.statusId !== undefined && { statusId: json.statusId }),
    // A person's status or translation (or 확인함) makes the status theirs: the ✦ goes.
    ...((json.statusId !== undefined || json.translation !== undefined || json.checked) && 'statusBy' in row && { statusBy: 'human', statusRunId: null }),
    ...(json.listener !== undefined && { listener: json.listener, listenerOrigin: 'human', listenerConfidence: null }),
    ...(json.translation !== undefined && { translation: json.translation, origin: 'human', model: null }),
    ...(json.tagIds !== undefined && 'tagIds' in row && { tagIds: json.tagIds }),
    ...(json.note !== undefined && { note: json.note.trim() }),
    ...(json.translate !== undefined && { translate: json.translate }),
    ...((json.addTagIds || json.removeTagIds) && Array.isArray(row.tagIds) && { tagIds: [...new Set([...(row.tagIds as string[]).filter((id) => !json.removeTagIds?.includes(id)), ...(json.addTagIds ?? [])])] }),
  });
}
