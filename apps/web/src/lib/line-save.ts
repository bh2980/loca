import { useMutation, useQueryClient } from '@tanstack/react-query';
import { client, unwrap } from './api';
import { optimistic, patchedLine, unitChanges } from './optimistic';

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
export function useSaveLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ unitId, candidateText: _shown, ...json }: LineSaveInput) => unwrap(client.units[':unitId'].save.$post({ param: { unitId }, json })),
    onMutate: async ({ unitId, text, candidateText, statusId }) => {
      const translation = text ?? candidateText;
      const change = { ...(translation !== undefined && { translation }), ...(statusId && { statusId }) };
      return { undo: Object.keys(change).length ? await optimistic(queryClient, unitChanges([unitId], patchedLine(change))) : undefined };
    },
    onError: (_error, _input, context) => context?.undo?.(),
  });
}

/** The same save outside a component (same-source apply goes through many lines one by one). */
export const saveLineNow = ({ unitId, candidateText: _shown, ...json }: LineSaveInput) => unwrap(client.units[':unitId'].save.$post({ param: { unitId }, json }));
