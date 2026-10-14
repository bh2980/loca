import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { PathNodeText, PathSlice } from '@/components/graph/path-graph';
import type { OverviewNode } from '@/components/graph/path-window';

/** The other ways out of a choice: said in the pane of its node, never drawn as boxes. */
export interface ForkChoices {
  /** The fork's node id (what a pick is stored against). */
  forkNodeId: string;
  /** Stubs leaving the choice ('다른 선택 N개'). */
  count: number;
  picked: boolean;
  /** Every arm of the fork. `lines` / `alone` are those of its stub (the arm not taken). */
  arms: { id: string; label: string; chosen: boolean; lines?: number; alone?: boolean }[];
}

/** The choice made at an overview node with the other arms it leaves, or undefined when the node is no choice with stubs. */
export function forkChoices(slice: PathSlice, node: OverviewNode | undefined): ForkChoices | undefined {
  if (!node?.choice) return undefined;
  const blockOf = new Map(slice.blocks.flatMap((block) => block.nodeIds.map((id) => [id, block.id] as const)));
  const fork = slice.forks.find((item) => (blockOf.get(item.nodeId) ?? item.nodeId) === node.id);
  if (!fork) return undefined;
  const count = slice.stubs.filter((stub) => stub.fork === fork.nodeId).length;
  if (!count) return undefined;
  const stubOf = new Map(slice.stubs.filter((stub) => stub.fork === fork.nodeId).map((stub) => [stub.arm, stub] as const));
  return {
    forkNodeId: fork.nodeId,
    count,
    picked: fork.mode === 'choice' && fork.arms.some((arm) => arm.picked),
    arms: fork.arms.map((arm) => {
      const stub = stubOf.get(arm.nodeId);
      return { id: arm.nodeId, label: arm.label, chosen: arm.chosen, lines: stub?.lines, alone: stub ? stub.rejoins.length === 0 : undefined };
    }),
  };
}

/** What a node says about itself where a loop points at it: its first line, else what kind of place it is. */
export function describeNode(node: OverviewNode | undefined, texts: Map<string, PathNodeText>) {
  const first = node?.nodeIds.map((id) => texts.get(id)).find((item) => item?.text);
  if (first?.text) return first.text.replace(/\s+/g, ' ').slice(0, 40);
  return node?.kind === 'section' ? '구간' : node?.choice ? '조건' : '줄';
}

/**
 * '다른 선택' and '되돌아가는 곳': what the path graph used to hang on the node itself (a chip and a
 * note), now in the pane that opens when the node is selected.
 */
export function PathNodeExtras({ choices, loops, onPick, onAuto }: { choices?: ForkChoices; loops: string[]; onPick: (forkNodeId: string, armId: string) => void; onAuto: (forkNodeId: string) => void }) {
  if (!choices && !loops.length) return null;
  const chosen = choices?.arms.find((arm) => arm.chosen);
  return (
    <>
      {choices && (
        <PaneSection title="다른 선택">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="max-w-full justify-between" data-testid="fork-menu">
                <span className="truncate">{chosen?.label ?? '갈래 고르기'}</span>
                <span className="shrink-0 text-muted-foreground">다른 선택 {choices.count.toLocaleString()}개</span>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-80">
              {choices.arms.map((arm) => (
                <DropdownMenuCheckboxItem key={arm.id} checked={arm.chosen} onCheckedChange={() => !arm.chosen && onPick(choices.forkNodeId, arm.id)}>
                  <span className="truncate">{arm.label}</span>
                  {!arm.chosen && arm.lines !== undefined && (
                    <span className="shrink-0 text-muted-foreground">
                      · {arm.lines.toLocaleString()}줄{arm.alone ? ' · 따로 끝남' : ''}
                    </span>
                  )}
                </DropdownMenuCheckboxItem>
              ))}
              {choices.picked && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onAuto(choices.forkNodeId)}>자동으로 고르기</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="mt-2 text-xs text-muted-foreground">다른 갈래를 고르면 이 길이 그 갈래로 바뀝니다.</p>
        </PaneSection>
      )}
      {loops.length > 0 && (
        <PaneSection title="되돌아가는 곳">
          <ul className="space-y-1 text-sm" data-testid="loop-list">
            {loops.map((to, index) => (
              <li key={index} className="truncate" title={`‹${to}›로 되돌아감`}>
                ↺ ‹{to}›로 되돌아감
              </li>
            ))}
          </ul>
        </PaneSection>
      )}
    </>
  );
}

/**
 * The right-hand pane of a node picked on the map. The lines themselves are translated in the list
 * in the middle; this says what the node is and holds what the map does not draw on it.
 */
export function PathNodePane({ title, subtitle, extras, onClose }: { title: string; subtitle?: string; extras: ReactNode; onClose: () => void }) {
  return (
    <DetailPane kicker="길 조각" title={title} subtitle={subtitle} onClose={onClose}>
      {extras ?? <p className="text-sm text-muted-foreground">이 노드의 줄은 가운데 목록에서 번역합니다. 다른 선택도 되돌아가는 곳도 없는 노드입니다.</p>}
    </DetailPane>
  );
}
