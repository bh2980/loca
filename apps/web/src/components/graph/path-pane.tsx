import { InspectorField, InspectorFields, InspectorList, InspectorSection, Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@loca/ui';
import type { PathNodeText, PathSlice } from '@/components/graph/path-graph';
import type { OverviewNode } from '@/components/graph/path-window';

const AUTO = '__auto';

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
        <InspectorSection title="다른 선택">
          <InspectorFields>
            <InspectorField label="이 선택에서 따라갈 갈래" description={`다른 선택 ${choices.count.toLocaleString()}개`}>
              <Select value={chosen?.id ?? ''} onValueChange={(value) => (value === AUTO ? onAuto(choices.forkNodeId) : onPick(choices.forkNodeId, value))}>
                <SelectTrigger className="w-full" data-testid="fork-menu">
                  <SelectValue placeholder="갈래 고르기" />
                </SelectTrigger>
                <SelectContent>
                  {choices.arms.map((arm) => (
                    <SelectItem key={arm.id} value={arm.id}>
                      {arm.label}
                      {!arm.chosen && arm.lines !== undefined && ` · ${arm.lines.toLocaleString()}줄${arm.alone ? ' · 따로 끝남' : ''}`}
                    </SelectItem>
                  ))}
                  {choices.picked && (
                    <>
                      <SelectSeparator />
                      <SelectItem value={AUTO}>자동으로 고르기</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </InspectorField>
          </InspectorFields>
        </InspectorSection>
      )}
      {loops.length > 0 && (
        <InspectorSection title="되돌아가는 곳">
          <div data-testid="loop-list"><InspectorList className="text-sm">
            {loops.map((to, index) => (
              <li key={index} className="truncate py-1.5 first:pt-0 last:pb-0">
                ↺ ‹{to}›로 되돌아감
              </li>
            ))}
          </InspectorList></div>
        </InspectorSection>
      )}
    </>
  );
}
