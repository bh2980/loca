import { useMutation } from '@tanstack/react-query';
import { client } from './api';
import { changeLines, patchedLine } from './units';

/** One save of a line's text and/or status (server: POST /units/:unitId/save, services/line-save.ts). */
export interface LineSaveInput {
  unitId: string;
  text?: string;
  candidateId?: string;
  /** The candidate's text, so the line shows it at once when a candidate is picked. */
  candidateText?: string;
  statusId?: string;
  /** The translation the edit started from: the server refuses to overwrite a line changed since. */
  base?: string | null;
}

/**
 * The single client path that writes a line's text or status. It shows the result at once
 * (optimistic) and puts it back if the server refuses; the server writes text, candidate and
 * status together, so no screen keeps its own variant of this save.
 */
export function useSaveLine(projectId: string) {
  return useMutation({
    mutationFn: ({ unitId, candidateText, ...json }: LineSaveInput) => {
      const translation = json.text ?? candidateText;
      return changeLines(projectId, [unitId], patchedLine({ ...(translation !== undefined && { translation }), ...(json.statusId && { statusId: json.statusId }) }), () => client.units[':unitId'].save.$post({ param: { unitId }, json }));
    },
  });
}
