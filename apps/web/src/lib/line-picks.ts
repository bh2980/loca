import { useMemo } from 'react';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { client, unwrap } from './api';
import { isCurrent, queryClient } from './query-client';
import { idsFingerprint, key } from './query-keys';
import { useLines } from './units';

/**
 * What the bulk bar says about the picked lines: which of them an AI decided (확인함 acts on those) and how far each
 * tag is on them. The lines the browser holds are read from its rows; picks outlive the page they were made on, and a
 * filter picked whole is thousands of lines, so the rest are a question answered with ids and counts (POST
 * units/picked), asked again whenever lines change (units topic). Nothing of a line is copied here.
 */
const pickedAway = (projectId: string, ids: readonly string[]) =>
  queryOptions({
    // The ids are too many for a key: their fingerprint stands for them.
    queryKey: key('units', 'picked', projectId, idsFingerprint(ids)),
    queryFn: () => unwrap(client.projects[':projectId'].units.picked.$post({ param: { projectId }, json: { ids: [...ids] } })),
    placeholderData: keepPreviousData,
  });

/**
 * The answer about picks the browser does not hold, as of now: the one the bar shows unless lines changed since
 * (then the fresh one, waited for). A bulk change sends its `asOf` (lib/line-writes.ts).
 */
export function pickedNow(projectId: string, ids: readonly string[]) {
  const options = pickedAway(projectId, ids);
  return queryClient.fetchQuery({ ...options, staleTime: isCurrent(options.queryKey) ? Infinity : 0 });
}

export type TagState = 'all' | 'some' | 'none';

export function usePickedLines(projectId: string, picked: ReadonlySet<string>) {
  const { byId } = useLines(projectId, undefined);
  const away = useMemo(() => [...picked].filter((id) => !byId.has(id)), [picked, byId]);
  const rest = useQuery({ ...pickedAway(projectId, away), enabled: away.length > 0 }).data;
  return useMemo(() => {
    const held = [...picked].flatMap((id) => byId.get(id) ?? []);
    const others = away.length ? rest : undefined;
    const byAi = [...held.filter((line) => line.statusBy === 'ai').map((line) => line.id), ...(others?.byAi ?? [])];
    const tagged = new Map<string, number>(Object.entries(others?.tags ?? {}));
    for (const line of held) for (const tagId of line.tagIds) tagged.set(tagId, (tagged.get(tagId) ?? 0) + 1);
    /** Whether a tag is on all, some or none of the picked lines (until the rest is known: as far as the held ones say). */
    const tagState = (tagId: string): TagState => {
      const count = tagged.get(tagId) ?? 0;
      return count === 0 ? 'none' : count >= picked.size ? 'all' : 'some';
    };
    return { byAi, tagState };
  }, [picked, byId, away, rest]);
}
