import { Fragment } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ArrowLeftRight, ArrowUpDown, Copy, Focus, Frame, Group, LayoutGrid, LogOut, Maximize, Plus, SlidersHorizontal, Trash2, Unlink } from 'lucide-react';
import type { WorkflowDefinition, WorkflowNode } from '@loca/shared';
import { Box, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, Icon, PointMenu, Text, type CanvasDirection, type NodeLibraryGroup } from '@loca/ui';
import { fitWhole } from './flow-canvas';
import { groupOf } from './frames';
import type { WorkflowEditing } from './use-workflow-editing';
import type { WorkflowLayout } from './use-workflow-layout';
import type { WorkflowSelection } from './use-workflow-selection';
import type { WorkflowView } from './use-workflow-view';

/** Where the editor's canvas was right-clicked, and on what: one node, the picked nodes, a line, or the empty canvas. */
export type EditorMenuTarget = { x: number; y: number } & ({ kind: 'node'; node: WorkflowNode } | { kind: 'nodes'; ids: string[] } | { kind: 'edge'; edgeId: string } | { kind: 'pane' });

interface Props {
  menu: EditorMenuTarget | null;
  onClose: () => void;
  definition: WorkflowDefinition;
  palette: NodeLibraryGroup[];
  direction: CanvasDirection;
  selection: WorkflowSelection;
  view: WorkflowView;
  editing: WorkflowEditing;
  layout: WorkflowLayout;
}

/**
 * The workflow editor's right-click menu. It acts on the node under the pointer (or the picked nodes when it opens
 * on one of them); the selection and its config pane stay as they were.
 */
export function EditorContextMenu({ menu, onClose, definition, palette, direction, selection, view, editing, layout }: Props) {
  const flow = useReactFlow();
  /** The items that move nodes between frames: into another one, or out of theirs. */
  const frameItems = (ids: string[]) => {
    const groups = definition.groups ?? [];
    const own = new Set(ids.map((id) => groupOf(groups, id)));
    const others = groups.filter((group) => !(own.size === 1 && own.has(group.id)));
    return (
      <>
        {others.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger><Icon icon={Frame} size="sm" /><span>프레임으로 옮기기</span></ContextMenuSubTrigger>
            <Box asChild width="menu">
              <ContextMenuSubContent>
                {others.map((group) => (
                  <ContextMenuItem key={group.id} onSelect={() => editing.moveToFrame(ids, group.id)}>
                    <Text truncate>{group.label || '이름 없는 프레임'}</Text>
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </Box>
          </ContextMenuSub>
        )}
        {[...own].some(Boolean) && <ContextMenuItem onSelect={() => editing.moveToFrame(ids, null)}><Icon icon={LogOut} size="sm" /><span>프레임에서 빼기</span></ContextMenuItem>}
        <ContextMenuSeparator />
      </>
    );
  };
  const shownOnly = (ids: string[]) => ids.filter((id) => view.shownIds.has(id));
  return (
    <PointMenu at={menu} onClose={onClose}>
      {menu?.kind === 'node' && (() => {
        const { node } = menu;
        const lines = definition.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
        return (
          <Box asChild width="menu">
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => selection.select(node.id)}><Icon icon={SlidersHorizontal} size="sm" /><span>설정 열기</span></ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => editing.groupPicked([node.id])}><Icon icon={Group} size="sm" /><span>새 프레임으로 묶기</span></ContextMenuItem>
              {frameItems([node.id])}
              <ContextMenuItem onSelect={() => editing.duplicateNode(node)}><Icon icon={Copy} size="sm" /><span>복제</span></ContextMenuItem>
              <ContextMenuItem disabled={lines.length === 0} onSelect={() => editing.removeEdges(lines.map((edge) => edge.id))}><Icon icon={Unlink} size="sm" /><span>연결 끊기</span></ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => editing.deleteNodes([node.id])}><Icon icon={Trash2} size="sm" /><span>삭제</span></ContextMenuItem>
            </ContextMenuContent>
          </Box>
        );
      })()}
      {menu?.kind === 'nodes' && (
        <Box asChild width="menu">
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => editing.groupPicked(shownOnly(menu.ids))}><Icon icon={Group} size="sm" /><span>프레임으로 묶기</span></ContextMenuItem>
            {frameItems(menu.ids)}
            <ContextMenuItem onSelect={() => editing.duplicateNodes(menu.ids)}><Icon icon={Copy} size="sm" /><span>{menu.ids.length}개 복제</span></ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => editing.deleteNodes(menu.ids)}><Icon icon={Trash2} size="sm" /><span>{menu.ids.length}개 삭제</span></ContextMenuItem>
          </ContextMenuContent>
        </Box>
      )}
      {menu?.kind === 'edge' && (
        <Box asChild width="field-lg">
          <ContextMenuContent>
            <ContextMenuItem variant="destructive" onSelect={() => editing.removeEdges([menu.edgeId])}><Icon icon={Trash2} size="sm" /><span>연결 삭제</span></ContextMenuItem>
          </ContextMenuContent>
        </Box>
      )}
      {menu?.kind === 'pane' && (
        <Box asChild width="menu">
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => editing.createFrame(editing.frameAtScreen(menu.x, menu.y))}><Icon icon={Frame} size="sm" /><span>여기에 프레임 추가</span></ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger><Icon icon={Plus} size="sm" /><span>노드 추가</span></ContextMenuSubTrigger>
              <Box asChild width="field-lg">
                <ContextMenuSubContent>
                  {palette.map((group, index) => (
                    <Fragment key={group.id}>
                      {index > 0 && <ContextMenuSeparator />}
                      <ContextMenuLabel>{group.label}</ContextMenuLabel>
                      {group.items.map((item) => (
                        <ContextMenuItem key={item.id} onSelect={() => editing.addFromLibrary(item.id, flow.screenToFlowPosition({ x: menu.x, y: menu.y }))}>
                          <span>{item.label}</span>
                        </ContextMenuItem>
                      ))}
                    </Fragment>
                  ))}
                </ContextMenuSubContent>
              </Box>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void layout.arrange(direction, true)}><Icon icon={LayoutGrid} size="sm" /><span>자동 정렬</span></ContextMenuItem>
            <ContextMenuItem onSelect={() => fitWhole(flow, 200)}><Icon icon={Maximize} size="sm" /><span>화면에 맞춤</span></ContextMenuItem>
            <ContextMenuItem onSelect={() => void flow.zoomTo(1, { duration: 180 })}><Icon icon={Focus} size="sm" /><span>100% 배율</span></ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => layout.changeDirection(direction === 'vertical' ? 'horizontal' : 'vertical')}>
              <Icon icon={direction === 'vertical' ? ArrowLeftRight : ArrowUpDown} size="sm" />
              <span>{direction === 'vertical' ? '가로 배치' : '세로 배치'}</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </Box>
      )}
    </PointMenu>
  );
}
