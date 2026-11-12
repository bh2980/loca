import { useMutation } from '@tanstack/react-query';
import { client } from './api';
import { changeLines, lineRev, patchedLine } from './units';

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
 * The single client path that writes a line's text or status. It shows the result at once
 * (optimistic) and puts it back if the server refuses; the server writes text, candidate and
 * status together, so no screen keeps its own variant of this save. Every save carries the line's
 * rev as this browser holds it: a line changed since (a run, another window) is not written over.
 */
export function useSaveLine(projectId: string) {
  return useMutation({
    mutationFn: ({ unitId, candidateText, ...json }: LineSaveInput) => {
      const translation = json.text ?? candidateText;
      const rev = lineRev(projectId, unitId);
      return changeLines(projectId, [unitId], patchedLine({ ...(translation !== undefined && { translation }), ...(json.statusId && { statusId: json.statusId }) }), () => client.units[':unitId'].save.$post({ param: { unitId }, json: { ...json, ...(rev !== undefined && { rev }) } }));
    },
  });
}
