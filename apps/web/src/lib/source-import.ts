import { queryOptions } from '@tanstack/react-query';
import type { AddSourceInput, SourceFile } from '@loca/shared';
import { client, unwrap } from './api';
import { sent } from './collections';
import { queryClient } from './query-client';
import { ownFamily, ownKey } from './query-keys';
import { undoChange } from './undo';

/**
 * What adding a picked file would do (원문 비교): its new, changed and same keys, the formats its new lines bring and what
 * nothing has. Asked again when this page adds or takes back (see `source-diff` in lib/query-keys.ts). `fileId` names
 * the picked file in the key; the file itself is the question's body.
 */
export const sourceDiff = (projectId: string, fileId: string, file: SourceFile) =>
  queryOptions({ ...ownKey('source-diff', projectId, fileId), queryFn: () => unwrap(client.projects[':projectId'].source.diff.$post({ param: { projectId }, json: file })) });

const compareAgain = () => queryClient.invalidateQueries({ queryKey: ownFamily('source-diff') });

/** 원문 넣기: the file's new keys go into the project, with the formats to turn on; done once the feed has them. Answers with what was added and its undo token. */
export async function addSourceFile(projectId: string, file: AddSourceInput) {
  const added = await sent(projectId, client.projects[':projectId'].source.add.$post({ param: { projectId }, json: file }));
  void compareAgain();
  return added;
}

/** Takes back what addSourceFile added (its token), format rules included. */
export async function undoSourceFile(projectId: string, token: string) {
  await undoChange(projectId, token);
  void compareAgain();
}
