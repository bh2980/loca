import { useEffect, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useGraphNodes } from '@/lib/graph';
import { lineSurroundings, useLineDetail } from '@/lib/units';
import { useReportView } from '@/lib/view-context';
import { nextWithLines, stopText } from './flow-model';
import type { GraphCanvasHandle } from './graph-canvas';
import { graphSearch } from './graph-search';
import { LINE_CARD_WIDTH } from './line-card';
import type { DrawnGraphData } from './use-drawn-graph';
import type { GraphNav } from './use-graph-nav';

/**
 * Translating in the graph: the card beside a node (`edit` in the URL is its line). The selection's lines in order
 * (choices included: their text is translated too), which of them the card is on and where the card stands, and the
 * steps a person takes from it: the next or previous line of the selection, then on along the flow while it does
 * not fork (Alt+↓/↑ in the card), the first line still without a translation when a node is opened to translate.
 */
export function useLineCard({ nav, drawn, canvas }: { nav: GraphNav; drawn: DrawnGraphData; canvas: RefObject<GraphCanvasHandle | null> }) {
  const { projectId, search, set } = nav;
  const { model, layout, portals, nodeById } = drawn;
  const dialogue = search.scope === 'dialogue';
  const flowIds = dialogue && search.node && layout ? model.flowOf(search.node) : [];
  const flowNodes = useGraphNodes(projectId, flowIds);
  const ready = flowIds.length > 0 && flowNodes.every((result) => result.data);
  const units = flowNodes.flatMap((result) => result.data?.units ?? []);
  const lines = flowNodes.flatMap((result) => (result.data ? result.data.units.map((unit) => ({ unitId: unit.id, nodeId: result.data!.id, choice: result.data!.kind === 'choice' })) : []));
  const at = lines.findIndex((line) => line.unitId === search.edit);
  const anchorId = at >= 0 ? model.anchorOf(lines[at]!.nodeId) : undefined;
  /** Where a person would start translating the selection: its first line without a translation, else its first. */
  const firstToTranslate = () => lines.find((line) => line.unitId === units.find((unit) => !unit.translation)?.id) ?? lines[0];

  // The line open in the card reports itself to the chat (the selected node reports itself from its pane).
  const editUnit = useLineDetail(projectId, search.edit ?? '');
  useReportView('graph-line', [
    editUnit.data && {
      kind: '대사',
      id: editUnit.data.id,
      label: `${editUnit.data.speaker?.trim() ? `${editUnit.data.speaker.trim()}: ` : ''}${editUnit.data.source.slice(0, 40)}`,
      detail: JSON.stringify({ key: editUnit.data.key }),
    },
  ]);

  const edit = (unitId: string | undefined) => set(graphSearch.edit(unitId));
  // A selection made while translating opens the card once its lines have arrived: on its first line after a step
  // forward, its last after a step back, and (direction 0: a node picked) its first line without a translation.
  const [follow, setFollow] = useState<{ node: string; direction: 1 | -1 | 0 }>();
  useEffect(() => {
    if (!follow || follow.node !== search.node || !ready) return;
    setFollow(undefined);
    const line = follow.direction === 0 ? firstToTranslate() : follow.direction === 1 ? lines[0] : lines[lines.length - 1];
    if (line) edit(line.unitId);
  }, [follow, search.node, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (direction: 1 | -1) => {
    const next = lines[at + direction];
    if (at >= 0 && next) return edit(next.unitId);
    if (!search.node || !layout) return;
    // Nodes without lines (conditions) are passed through; where the way stops, the card stays.
    const found = nextWithLines(model, search.node, direction, { hasLines: (id) => (nodeById.get(id)?.total ?? 0) > 0, isPortal: (id) => portals.has(id) });
    if ('blocked' in found) return void toast(found.blocked === 'portal' ? '다음 대사는 다른 구역에 이어집니다. 그래프의 이름표를 눌러 넘어가세요.' : stopText(found.blocked));
    setFollow({ node: found.target, direction });
    canvas.current?.reveal(model.anchorOf(found.target), LINE_CARD_WIDTH);
    set(graphSearch.nodeAlongFlow(found.target));
  };

  // The lines either side are loaded ahead, so stepping shows them at once.
  const queryClient = useQueryClient();
  useEffect(() => {
    for (const line of [lines[at - 1], lines[at + 1]]) if (line && at >= 0) void queryClient.prefetchQuery(lineSurroundings(line.unitId));
  }, [search.edit, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // The card opens beside its node with room for itself; the graph pans only when it has to.
  useEffect(() => {
    if (anchorId) canvas.current?.reveal(anchorId, LINE_CARD_WIDTH);
  }, [anchorId, search.edit]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    lines,
    /** The card's line among `lines` (-1: no card). */
    at,
    anchorId,
    edit,
    step,
    /** Enter on the canvas, like the pane's 번역하기. */
    start: () => {
      const line = firstToTranslate();
      if (line) edit(line.unitId);
    },
    /** Opens the card on a node once it is the selection and its lines are here. */
    followTo: (node: string) => setFollow({ node, direction: 0 }),
    /** A line of a node among the selection's, for opening it elsewhere. */
    lineOf: (nodeId: string) => lines.find((line) => line.nodeId === nodeId)?.unitId,
  };
}

export type LineCardState = ReturnType<typeof useLineCard>;
