import { useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { Box, Button, Chip, EmptyDescription, EmptyHeader, EmptyState, EmptyTitle, FoundNodeList, Icon, Inline, Input, Notice, Overlay, PointPopover, PopoverContent, SearchField, SegmentedControl, SelectionBar, Spinner, Stack, Switch, Text } from '@loca/ui';
import type { GraphSelection } from '@/lib/graph-selection';
import { GRAPH_SHOW_ITEMS, type GraphShow } from '@/lib/graph-show';
import { graphSearch } from './graph-search';
import type { GraphNodeRow } from './node-cards';
import { KIND_LABEL } from './shapes';
import { TypeLegend } from './type-legend';
import type { DrawnGraphData } from './use-drawn-graph';
import type { GraphEditing } from './use-graph-editing';
import type { GraphNav } from './use-graph-nav';
import type { NodeSets } from './use-node-sets';

/** The node finder over the canvas: the box, and under it the nodes its text matches (key, label, first line). */
function NodeFinder({ value, onChange, matches, onPick }: { value: string | undefined; onChange: (value: string | undefined) => void; matches: readonly GraphNodeRow[]; onPick: (nodeId: string) => void }) {
  return (
    <Box position="relative" width="popover-lg" maxWidth="full" minWidth={0} shrink userSelect="none">
      <SearchField value={value} onChange={onChange} placeholder="노드 찾기 (키·라벨·첫 대사)" onCanvas />
      {matches.length > 0 && (
        <FoundNodeList>
          {matches.map((node) => (
            <li key={node.id}>
              <Button variant="ghost" size="row" display="flex" width="full" align="start" radius="md" paddingY="tight" textAlign="start" onClick={() => onPick(node.id)}>
                <Text width="field-xs" shrink={false} paddingTop="hair" variant="caption" tone="muted">{KIND_LABEL[node.kind] ?? node.kind}</Text>
                <Text minWidth={0} grow>
                  <Text display="block" truncate variant="body" tone="default">{node.label ?? node.key}</Text>
                  {node.preview && <Text display="block" truncate variant="caption" tone="muted">{node.preview}</Text>}
                </Text>
              </Button>
            </li>
          ))}
        </FoundNodeList>
      )}
    </Box>
  );
}

/** The controls at the canvas's top left: the finder, what the cards show, and the node types (dialogue graph). */
export function GraphTools({ nav, drawn, onFound }: { nav: GraphNav; drawn: DrawnGraphData; onFound: (nodeId: string) => void }) {
  const { search, set } = nav;
  const dialogue = search.scope === 'dialogue';
  return (
    <>
      <NodeFinder value={search.q} onChange={(q) => set(graphSearch.find(q))} matches={drawn.matches} onPick={onFound} />
      {dialogue && <SegmentedControl ariaLabel="카드에 보여 줄 것" value={drawn.show} onChange={(next) => drawn.setShow(next as GraphShow)} items={GRAPH_SHOW_ITEMS} />}
      {dialogue && drawn.data && <TypeLegend nodes={drawn.data.nodes} nodeTypes={drawn.data.nodeTypes} active={search.type} onPick={(type) => set(graphSearch.type(type))} />}
    </>
  );
}

/**
 * What the canvas says about its state, under the tools: the picked nodes with what can be done with them (the
 * same actions as the right-click menu), the open view, what is highlighted, and the scene graph's hidden links.
 */
export function GraphBars({ nav, drawn, selection, editing, sets }: { nav: GraphNav; drawn: DrawnGraphData; selection: GraphSelection; editing: GraphEditing; sets: NodeSets }) {
  const { search, go, set } = nav;
  const { picked } = selection;
  const { view, viewDetail, mark, layout, highlight, chosen, hidden, derivedEdges } = drawn;
  return (
    <>
      {/* 보기 만들기 › 노드 골라서: until a node is picked the bar says how; then it is the picked set's bar. */}
      {sets.collecting && !picked.size && (
        <Chip as="div" variant="bar" role="status">
          <Icon icon={MousePointerClick} size="xs" />
          <span>보기에 넣을 노드를 누르거나 끌어서 고르세요</span>
          <Button variant="ghost" size="inline" disabled>이름 정하기</Button>
          <Button variant="ghost" size="inline" onClick={sets.stopCollecting}>취소</Button>
        </Chip>
      )}
      {sets.collecting && picked.size > 0 && (
        <SelectionBar floating count={picked.size} onClear={selection.clear}>
          <Text tone="muted">보기에 넣을 노드 · 누르면 더하고 다시 누르면 뺍니다</Text>
          <Button variant="ghost" onClick={() => sets.name(picked)}>이름 정하기</Button>
          <Button variant="ghost" onClick={sets.stopCollecting}>취소</Button>
        </SelectionBar>
      )}
      {!sets.collecting && picked.size > 1 && (
        <SelectionBar floating count={picked.size} onClear={selection.clear}>
          <Button variant="ghost" onClick={() => sets.name(picked)}>보기로 저장</Button>
          <Button variant="ghost" onClick={() => void sets.run(picked)}>워크플로 실행</Button>
          {editing.editing && <Button variant="ghost" onClick={() => void editing.edits.linkInOrder({ nodeIds: sets.real(picked) })}>대본 순서로 잇기</Button>}
        </SelectionBar>
      )}
      {view && viewDetail.data && (
        <Chip as="div" variant="bar" removable>
          <span>
            보기 "{view.label}" · 남김 {view.nodes.toLocaleString()} · 생략 구간 {derivedEdges.toLocaleString()} · {viewDetail.data.route ? '경로' : viewDetail.data.origin === 'ai' ? 'AI' : '직접'}
            {viewDetail.data.missing.length > 0 && <Text tone="danger"> · 원본에 없음 {viewDetail.data.missing.length.toLocaleString()}</Text>}
          </span>
          <Button variant="ghost" onClick={() => set(graphSearch.viewInfo(true))}>보기</Button>
        </Chip>
      )}
      {search.mark && mark.data && layout && (
        <Chip as="div" variant="bar" removable>
          <Chip.Dot />
          <span>
            강조{mark.data.label ? ` "${mark.data.label}"` : ''} · 이 화면 {layout.nodes.filter((node) => highlight?.has(node.id)).length.toLocaleString()} / {mark.data.nodeIds.length.toLocaleString()}개
          </span>
          {mark.data.section && mark.data.section !== chosen && <Button variant="ghost" onClick={() => go(graphSearch.markSection(mark.data.section!))}>가장 많은 구역으로</Button>}
          <Button variant="ghost" onClick={() => set(graphSearch.unmark())}>강조 해제</Button>
        </Chip>
      )}
      {hidden.length > 0 && (
        <Chip as="label" variant="bar" tone="muted">
          <Switch checked={search.links === 'all'} onCheckedChange={(on) => set(graphSearch.links(on))} />
          장면 경유 연결 {hidden.length.toLocaleString()}
        </Chip>
      )}
    </>
  );
}

/** Naming a view made from picked nodes: a small popover where the menu was (or over the canvas). */
export function NameViewPopover({ sets }: { sets: NodeSets }) {
  return (
    <PointPopover at={sets.naming?.at} onClose={sets.cancelNaming}>
      <NameViewForm sets={sets} />
    </PointPopover>
  );
}

function NameViewForm({ sets }: { sets: NodeSets }) {
  // Mounted while the popover is open: every naming starts empty.
  const [name, setName] = useState('');
  return (
    <Box asChild spaceY="condensed">
      <PopoverContent align="start" width="popover">
        <Input autoFocus value={name} maxLength={80} aria-label="보기 이름" placeholder="예: 올렉 사망 분기" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sets.make(name)} />
        <Stack direction="row" justify="end" gap="condensed">
          <Button variant="ghost" onClick={sets.cancelNaming}>취소</Button>
          <Button disabled={!name.trim() || sets.making} onClick={() => sets.make(name)}>보기 만들기</Button>
        </Stack>
      </PopoverContent>
    </Box>
  );
}

/** What stands over the canvas while there is no layout to draw, or a new one is being made. */
export function GraphStatus({ drawn }: { drawn: DrawnGraphData }) {
  const { data, isPending, layout, relayout } = drawn;
  return (
    <>
      {(isPending || data?.status === 'pending') && !relayout && (
        <Overlay asChild><Inline justify="center" gap="condensed" variant="body" tone="muted">
          <Spinner /> 그래프 배치를 계산하는 중…
        </Inline></Overlay>
      )}
      {relayout && (
        <Notice variant="floating" placement="canvas" role="status">
          <Spinner /> 바뀐 내용으로 다시 배치하는 중…
        </Notice>
      )}
      {data?.status === 'failed' && <Text as="p" padding="spacious" variant="body" tone="danger">배치에 실패했습니다: {data.error}</Text>}
      {(data?.status === 'missing' || (data?.status === 'ready' && !layout?.nodes.length)) && (
        <EmptyState size="pane" overlay>
          <EmptyHeader>
            <EmptyTitle>그래프가 없습니다</EmptyTitle>
            <EmptyDescription>가져온 파일에 그래프 정보가 없습니다.</EmptyDescription>
          </EmptyHeader>
        </EmptyState>
      )}
    </>
  );
}
