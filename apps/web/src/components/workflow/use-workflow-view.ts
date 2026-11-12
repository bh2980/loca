import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowDefinition, WorkflowGroup } from '@loca/shared';
import type { CanvasDirection } from '@loca/ui';
import { useMeasuredSizes } from './flow-canvas';
import { computeFolds, foldedDefinition, foldPlacements, isFoldOpen, openFoldContaining, toggleFold, type Fold } from './fold';
import { frameNodes } from './frames';
import { useFoldState } from './use-fold-state';
import type { WorkflowDraftState } from './use-workflow-draft';
import type { WorkflowSelection } from './use-workflow-selection';

type Box = NonNullable<WorkflowGroup['box']>;

/**
 * The workflow as the editor draws it, from the definition being edited: which nodes are on the canvas (접기: nodes
 * that only hang off another node are chips until opened; display only, the definition is whole), the sizes React
 * Flow measured, and where each frame's box stands (it stands still while its nodes are dragged, and follows the
 * handle while it is resized).
 */
export function useWorkflowView({ workflowId, definition, direction, setDraft, selection }: {
  workflowId: string;
  definition: WorkflowDefinition | undefined;
  direction: CanvasDirection;
  setDraft: WorkflowDraftState['setDraft'];
  selection: WorkflowSelection;
}) {
  const { search, select, nodes: picked } = selection;
  const [measured, recordSizes] = useMeasuredSizes();
  /** The work nodes of the whole definition (the entry is not drawn). */
  const definitions = useMemo(() => (definition?.nodes ?? []).filter((node) => node.type !== 'entry'), [definition?.nodes]);
  const folds = useMemo(() => (definition ? computeFolds(definition) : []), [definition]);
  const [foldState, setFoldState] = useFoldState(`workflow.${workflowId}`);
  const openFolds = useMemo(() => new Set(foldState.open), [foldState]);
  /** The definition as drawn: closed folds' nodes and lines are not in it. */
  const drawn = useMemo(() => (definition ? foldedDefinition(definition, folds, openFolds) : undefined), [definition, folds, openFolds]);
  const shown = useMemo(() => (drawn?.definition.nodes ?? []).filter((node) => node.type !== 'entry'), [drawn]);
  // The nodes on the canvas: a folded one keeps a position it is not drawn at, so only these size a frame.
  const shownIds = useMemo(() => new Set(shown.map((node) => node.id)), [shown]);

  // A fold that just opened gets places that clear the visible nodes, written to the draft once: from
  // then on its nodes sit where they are stored, so dragging them (or their owner) never snaps back.
  // Folds already open when the editor loads were placed when they were opened: opening the editor is no edit.
  const placedOpen = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!definition) return;
    const before = placedOpen.current;
    placedOpen.current = openFolds;
    if (!before) return;
    const opened = new Set([...openFolds].filter((id) => !before.has(id)));
    if (!opened.size) return;
    const placed = foldPlacements(definition, folds.filter((fold) => opened.has(fold.id)), opened, new Map(Object.entries(measured)), direction);
    if (!placed.size) return;
    setDraft((value) => ({ ...value, definition: { ...value.definition, nodes: value.definition.nodes.map((node) => (placed.has(node.id) ? { ...node, position: placed.get(node.id)! } : node)) } }));
  }, [openFolds, folds]); // eslint-disable-line react-hooks/exhaustive-deps
  // Selecting a folded node (?node=, search, an issue) shows it.
  useEffect(() => setFoldState((state) => openFoldContaining(state, folds, search.node)), [search.node, folds, setFoldState]);
  /** Folding a fold that holds the open node or the picked ones puts the selection away with them. */
  const toggleFoldOf = (fold: Fold) => {
    setFoldState((state) => toggleFold(state, fold.id));
    if (isFoldOpen(foldState, fold.id)) {
      if (search.node && fold.nodeIds.includes(search.node)) select(undefined);
      if (picked.picked.size) picked.set([...picked.picked].filter((id) => !fold.nodeIds.includes(id)));
    }
  };

  // The steps the workflow stores, drawn as boxes behind the nodes. While nodes are dragged the boxes stand still
  // (`frozen`); while one is resized it follows the handle (`resizing`).
  const [frozen, setFrozen] = useState<Map<string, Box> | null>(null);
  const [resizing, setResizing] = useState<{ groupId: string; box: Box } | null>(null);
  const standing = useMemo(() => (resizing ? new Map([...(frozen ?? []), [resizing.groupId, resizing.box]]) : frozen ?? undefined), [frozen, resizing]);
  const frameBoxes = useMemo(() => frameNodes(shown, definition?.groups, measured, undefined, standing), [shown, definition?.groups, measured, standing]);

  return { measured, recordSizes, definitions, folds, foldState, setFoldState, drawn, shown, shownIds, toggleFoldOf, frameBoxes, setFrozen, setResizing };
}

export type WorkflowView = ReturnType<typeof useWorkflowView>;
