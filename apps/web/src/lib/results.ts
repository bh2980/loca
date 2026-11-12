import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { ResultRequest } from '@loca/shared';
import { client, unwrap } from './api';
import { key } from './query-keys';
import { stored, STORED } from './storage';

type Project = (typeof client.projects)[':projectId'];

/** What a file would hold (units topic: its lines may change while the dialog is open). */
export const resultPlan = (projectId: string, json: ResultRequest) =>
  queryOptions({
    queryKey: key('units', 'result-plan', projectId, json),
    queryFn: () => unwrap((client.projects[':projectId'] as Project).results.plan.$post({ param: { projectId }, json })),
    placeholderData: keepPreviousData,
  });

/** The lines in it whose translation would break the source's format. */
export const resultCheck = (projectId: string, json: ResultRequest) =>
  queryOptions({
    queryKey: key('units', 'result-check', projectId, json),
    queryFn: () => unwrap((client.projects[':projectId'] as Project).results.check.$post({ param: { projectId }, json })),
    placeholderData: keepPreviousData,
  });

/** Makes the file and hands it to the browser to save under the name the server gave it. */
export async function downloadResults(projectId: string, json: ResultRequest) {
  const response = await client.projects[':projectId'].results.$post({ param: { projectId }, json });
  if (!response.ok) await unwrap(Promise.resolve(response));
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name ? decodeURIComponent(name) : 'translations.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The statuses whose translation goes in at first: all of the lines someone picked; those the list is filtered to (the review inbox: the statuses it shows); else the final ones. */
export function startStatuses(target: 'view' | 'units' | 'groups', statuses: readonly { id: string; kind: string; inReview?: boolean }[], filter?: { statuses?: string[]; review?: true }) {
  if (target === 'units') return new Set(statuses.map((status) => status.id));
  if (target === 'view' && (filter?.statuses?.length || filter?.review)) {
    const listed = filter.review ? statuses.filter((status) => status.inReview).map((status) => status.id) : statuses.map((status) => status.id);
    return new Set(filter.statuses?.length ? filter.statuses.filter((id) => !filter.review || listed.includes(id)) : listed);
  }
  return new Set(statuses.filter((status) => status.kind === 'final').map((status) => status.id));
}

/** Why the rest of the lines do not go in, in words: "검토 필요 1,863 · 번역 없음 3 · 번역 제외 96". */
export function restParts(rest: { excluded: number; empty: number; statuses: Record<string, number> }, statuses: readonly { id: string; name: string }[]) {
  return [
    ...statuses.flatMap((status) => (rest.statuses[status.id] ? [`${status.name} ${rest.statuses[status.id]!.toLocaleString()}`] : [])),
    ...(rest.empty ? [`번역 없음 ${rest.empty.toLocaleString()}`] : []),
    ...(rest.excluded ? [`번역 제외 ${rest.excluded.toLocaleString()}`] : []),
  ].join(' · ');
}

/** What became of the rest the last time (this browser only): the source stands in until someone says otherwise. */
export const rememberedRest = (projectId: string) => stored(STORED.exportRest, projectId).read();
export const rememberRest = (projectId: string, rest: 'source' | 'omit') => stored(STORED.exportRest, projectId).write(rest);
