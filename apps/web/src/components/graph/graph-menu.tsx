import type { RefObject } from 'react';
import { toast } from 'sonner';
import { Box, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, PointMenu, Text } from '@loca/ui';
import { LineMenuFor } from '@/components/script/line-menu';
import type { GraphSelection } from '@/lib/graph-selection';
import { GRAPH_KEYS } from '@/lib/graph-shortcuts';
import { keyLabel } from '@/lib/keys';
import { resolveChainEndpoint } from './flow-model';
import type { GraphCanvasHandle } from './graph-canvas';
import { graphSearch } from './graph-search';
import type { DrawnGraphData } from './use-drawn-graph';
import type { GraphEditing } from './use-graph-editing';
import type { GraphNav } from './use-graph-nav';
import type { LineCardState } from './use-line-card';
import type { NodeSets } from './use-node-sets';

/** Where the canvas was right-clicked, and on what: a node, a line, or nothing (the empty canvas). */
export interface GraphMenuTarget {
  nodeId?: string;
  /** A right-click on a line (dialogue graph). */
  edgeId?: string;
  x: number;
  y: number;
}

interface Props {
  menu: GraphMenuTarget | null;
  onClose: () => void;
  nav: GraphNav;
  drawn: DrawnGraphData;
  selection: GraphSelection;
  editing: GraphEditing;
  sets: NodeSets;
  card: LineCardState;
  canvas: RefObject<GraphCanvasHandle | null>;
  select: (id: string | undefined) => void;
  /** Opens a node's pane and brings the pane into view. */
  onOpenDetail: (id: string) => void;
  onToggleFold: (runId: string) => void;
}

/**
 * The graph page's right-click menu. The canvas says where it was opened and on what; this says what each target
 * offers: several picked nodes (run, views, order, copy, delete), one dialogue node (translate here, open, route
 * ends, fold, the line's own menu, edits), a scene, a line, or the empty canvas (paste, fit, zoom, direction).
 * It acts on the node under the pointer; the selection (and the detail pane) stays as it was.
 */
export function GraphContextMenu({ menu, onClose, ...props }: Props) {
  const several = Boolean(menu?.nodeId && props.selection.picked.size > 1 && props.selection.picked.has(menu.nodeId));
  const dialogue = props.nav.search.scope === 'dialogue';
  return (
    <PointMenu at={menu} onClose={onClose}>
      {menu?.nodeId && dialogue && several && <PickedNodesMenu at={menu} {...props} />}
      {menu?.nodeId && dialogue && !several && <NodeMenu nodeId={menu.nodeId} {...props} />}
      {menu?.nodeId && !dialogue && <SceneMenu sceneId={menu.nodeId} {...props} />}
      {menu?.edgeId && <EdgeMenu edgeId={menu.edgeId} {...props} />}
      {menu && !menu.nodeId && !menu.edgeId && <CanvasMenu {...props} />}
    </PointMenu>
  );
}

type Parts = Omit<Props, 'menu' | 'onClose'>;

function PickedNodesMenu({ at, selection, editing, sets, drawn }: Parts & { at: { x: number; y: number } }) {
  const { picked } = selection;
  return (
    <ContextMenuContent width="menu-lg">
      <ContextMenuItem onSelect={() => void sets.run(picked)}>워크플로 실행…</ContextMenuItem>
      <ContextMenuSeparator />
      {/* The name is asked for where the menu was. */}
      <ContextMenuItem onSelect={() => sets.name(picked, { x: at.x, y: at.y })}>보기 만들기…</ContextMenuItem>
      <AddToViewMenu sets={sets} ids={picked} />
      {drawn.viewId && !drawn.viewDetail.data?.route && <ContextMenuItem onSelect={() => sets.leave(picked)}>보기에서 빼기 ({sets.real(picked).length.toLocaleString()})</ContextMenuItem>}
      {editing.editing && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void editing.edits.linkInOrder({ nodeIds: sets.real(picked) })}>대본 순서로 잇기</ContextMenuItem>
          <ContextMenuItem onSelect={() => void editing.paste([...picked])}>복제 ({picked.size.toLocaleString()}개)</ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={editing.removePicked}>
            삭제 ({picked.size.toLocaleString()}개)
            <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

function AddToViewMenu({ sets, ids }: { sets: NodeSets; ids: Iterable<string> }) {
  if (!sets.otherViews.length) return null;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>보기에 추가</ContextMenuSubTrigger>
      <Box asChild maxHeight="scroll" overflow="auto">
        <ContextMenuSubContent width="menu">
          {sets.otherViews.map((saved) => (
            <ContextMenuItem key={saved.id} onSelect={() => sets.addTo(saved.id, saved.label, ids)}>
              <Text truncate>{saved.origin === 'ai' ? '✦ ' : ''}{saved.label}</Text>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </Box>
    </ContextMenuSub>
  );
}

function NodeMenu({ nodeId, nav, drawn, editing, sets, card, select, onOpenDetail, onToggleFold }: Parts & { nodeId: string }) {
  const { projectId, search, navigate, go, set } = nav;
  const { layout, data, info, nodeById, openedFrom, viewId } = drawn;
  const folded = nodeId.startsWith('chain:');
  const node = nodeById.get(nodeId);
  // A card of one line has the line's own menu (as in the 대사 list); a folded run is several lines.
  const oneLine = node?.total === 1 && !folded;
  /** The start of a route is a line: a folded run picked as an end is its first or last node with lines. */
  const routeEnd = (role: 'start' | 'end') => resolveChainEndpoint(nodeId, role, layout?.chains, data?.nodes);
  return (
    <ContextMenuContent width="menu">
      <ContextMenuItem onSelect={() => {
        select(nodeId);
        card.followTo(nodeId);
        // Already the selection: its lines are here, so the card opens at once.
        if (search.node === nodeId) card.start();
      }}>이 자리에서 번역</ContextMenuItem>
      <ContextMenuItem onSelect={() => onOpenDetail(nodeId)}>상세 열기</ContextMenuItem>
      <ContextMenuItem onSelect={() => {
        const target = folded ? (layout?.chains?.find((chain) => chain.id === nodeId)?.nodeIds[0] ?? nodeId) : nodeId;
        const groupId = nodeById.get(target)?.groupId;
        const lineId = card.lineOf(target) ?? (search.node === nodeId ? card.lines[0]?.unitId : undefined);
        void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { ...(groupId ? { group: groupId } : {}), ...(lineId ? { line: lineId } : {}) } });
      }}>번역 화면에서 열기</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => go(graphSearch.startAt(routeEnd('start')))}>경로 시작으로</ContextMenuItem>
      <ContextMenuItem onSelect={() => go(graphSearch.endAt(routeEnd('end')))}>경로 끝으로</ContextMenuItem>
      <ContextMenuSeparator />
      {(info.get(nodeId)?.kind === 'chain' || openedFrom.has(nodeId)) && (
        <ContextMenuItem onSelect={() => onToggleFold(openedFrom.get(nodeId) ?? nodeId)}>{openedFrom.has(nodeId) ? '이어진 대사 접기' : '이어진 대사 펼치기'}</ContextMenuItem>
      )}
      {!oneLine && (
        <ContextMenuItem onSelect={() => {
          void navigator.clipboard.writeText(info.get(nodeId)?.key ?? nodeId);
          toast.success('노드 키를 복사했습니다.');
        }}>키 복사</ContextMenuItem>
      )}
      {oneLine && node?.unitId && (
        <>
          <ContextMenuSeparator />
          <LineMenuFor
            projectId={projectId}
            unitId={node.unitId}
            onEditSource={() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { line: node.unitId!, group: node.groupId ?? undefined, sourceAction: 'edit-unit', sourceKind: 'scene' } as never })}
          />
        </>
      )}
      {editing.editing && (
        <>
          <ContextMenuSeparator />
          {['script', 'chain'].includes(info.get(nodeId)?.kind ?? '') && <ContextMenuItem onSelect={() => set(graphSearch.addAfter(nodeId))}>이 대사 뒤에 대사 추가</ContextMenuItem>}
          <ContextMenuItem onSelect={() => void editing.paste([nodeId])}>복제</ContextMenuItem>
          <ContextMenuItem onSelect={() => editing.copied.copy([nodeId])}>
            복사
            <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.copy)}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => {
            void editing.edits.remove({ nodeIds: [nodeId] });
            if (search.node) select(undefined);
          }}>
            삭제
            <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
      {viewId && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => sets.leave([nodeId])}>보기에서 빼기</ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

function SceneMenu({ sceneId, nav, editing, onOpenDetail }: Parts & { sceneId: string }) {
  const scenes = editing.scenesOf(sceneId);
  return (
    <ContextMenuContent width="menu">
      <ContextMenuItem onSelect={() => void nav.navigate({ to: '/p/$projectId/script', params: { projectId: nav.projectId }, search: { group: sceneId } })}>장면 열기</ContextMenuItem>
      <ContextMenuItem onSelect={() => nav.go(graphSearch.sceneInDialogue(sceneId))}>대사 그래프에서 보기</ContextMenuItem>
      {scenes.length > 0 && <ContextMenuItem onSelect={() => editing.orderScenes(scenes)}>대본 순서로 잇기{scenes.length > 1 ? ` (${scenes.length.toLocaleString()}개 장면)` : ''}</ContextMenuItem>}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onOpenDetail(sceneId)}>상세 열기</ContextMenuItem>
    </ContextMenuContent>
  );
}

function EdgeMenu({ edgeId, editing }: Parts & { edgeId: string }) {
  return (
    <ContextMenuContent width="menu">
      <ContextMenuItem onSelect={() => editing.openEdge(edgeId)}>상세 열기</ContextMenuItem>
      {editing.edits.canDeleteEdge(edgeId) && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void editing.removeEdge(edgeId)}>
            삭제
            <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.remove)}</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

function CanvasMenu({ nav, drawn, editing, canvas }: Parts) {
  const copied = editing.editing ? editing.copied.read() : [];
  return (
    <ContextMenuContent width="menu">
      {copied.length > 0 && (
        <>
          <ContextMenuItem onSelect={() => void editing.paste(copied)}>
            붙여넣기
            <ContextMenuShortcut>{keyLabel(GRAPH_KEYS.paste)}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onSelect={() => canvas.current?.fit()}>화면에 맞춤</ContextMenuItem>
      <ContextMenuItem onSelect={() => canvas.current?.zoomTo(1)}>100% 배율</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => nav.go(graphSearch.direction(drawn.direction === 'vertical' ? 'horizontal' : 'vertical'))}>{drawn.direction === 'vertical' ? '가로 배치' : '세로 배치'}</ContextMenuItem>
    </ContextMenuContent>
  );
}
