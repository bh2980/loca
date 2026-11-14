import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookmarkPlus } from 'lucide-react';
import { viaWith } from '@loca/shared';
import { HeaderActions, Page } from '@/components/page';
import { ReadingRouteGraph } from '@/components/graph/reading-route-graph';
import { RouteList } from '@/components/graph/route-list';
import { useViewActions } from '@/components/graph/view-inspector';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Box, Button, GraphEndpointBar, GraphScriptSplit, Icon, Inline, Input, Popover, PopoverContent, PopoverTrigger, Spinner, SplitPane, Stack, Text } from '@loca/ui';
import { LineDetail } from '@/components/line-detail';
import type { GraphEndpointStep } from '@loca/ui';
import { q } from '@/lib/queries';
import { lineItem, routeItem, useReportView, viewItem } from '@/lib/reported-view';
import { useLineDetail } from '@/lib/units';
import { useRouteEndpoints } from './use-route-endpoints';
import { STORED, useStored } from '@/lib/storage';

/** 보기로 저장: names the route shown and stores it as a route view (its nodes, start, end and branches). */
function SaveRouteButton({ projectId, route, onSaved }: { projectId: string; route: { start: string; end: string; via?: string }; onSaved: (id: string) => void }) {
  const actions = useViewActions(projectId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = () => {
    if (!name.trim() || actions.create.isPending) return;
    actions.create.mutate({ label: name.trim(), route }, {
      onSuccess: ({ id }) => {
        setOpen(false);
        onSaved(id);
      },
    });
  };
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setName(''); }}>
      <PopoverTrigger asChild>
        <Button variant="outline"><Icon icon={BookmarkPlus} size="sm" marginRight="tight" />보기로 저장</Button>
      </PopoverTrigger>
      <Box asChild spaceY="condensed">
        <PopoverContent align="end" width="popover">
          <Input autoFocus value={name} maxLength={80} aria-label="보기 이름" placeholder="예: 1장 등대 가는 길" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && save()} />
          <Stack direction="row" justify="end" gap="condensed">
            <Button variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            <Button disabled={!name.trim() || actions.create.isPending} onClick={save}>저장</Button>
          </Stack>
        </PopoverContent>
      </Box>
    </Popover>
  );
}

/**
 * One reading route: its graph on the left, its lines in reading order on the right (the script). Shown
 * for a route not saved yet (picked start and end, with 보기로 저장), and as a saved route view's
 * 그래프 + 대본 layout, where taking another branch at a fork changes the view.
 */
export function PathMode({ projectId, toggle, viewMenu, layoutToggle, view, start, end, via: externalVia, onViaChange, direction, onDirectionChange, edit, detail, onDetail, onBeginPicking, onClear, onEdit, onSaved }: {
  projectId: string;
  toggle: ReactNode;
  /** The 보기 menu, beside a saved view's layout toggle. */
  viewMenu?: ReactNode;
  /** 그래프 | 그래프 + 대본, for a saved route view. */
  layoutToggle?: ReactNode;
  /** The saved route view shown (start, end and via are its route); absent for a route not saved yet. */
  view?: { id: string; label: string };
  start?: string;
  end?: string;
  via?: string;
  /** A saved view's change is done when this settles; it failing puts back the branch the view has. */
  onViaChange?: (via: string) => void | Promise<unknown>;
  direction: 'vertical' | 'horizontal';
  onDirectionChange: (direction: 'vertical' | 'horizontal') => void;
  edit?: string;
  /** The picked line's details open beside the script (상세 열기). */
  detail: boolean;
  onDetail: (on: boolean) => void;
  onBeginPicking?: (step: GraphEndpointStep) => void;
  onClear?: () => void;
  onEdit: (unitId: string | undefined) => void;
  /** A route not saved yet was saved as this view. */
  onSaved?: (id: string) => void;
}) {
  const { start: startValue, end: endValue } = useRouteEndpoints(projectId, { start, end });
  // The route goes to the chat as one item: the saved view by its name, a route not saved yet by its two ends.
  const reportedVia = externalVia ?? undefined;
  useReportView('reading-route', [
    view ? viewItem({ id: view.id, label: view.label, route: start && end ? { start, end, ...(reportedVia && { via: reportedVia }) } : null })
      : Boolean(start && end) && routeItem({ start: start!, end: end! }, { start: startValue?.name, end: endValue?.name }),
  ]);
  // The line picked in the route's graph or script, as the graph reports the line open in its card.
  const picked = useLineDetail(projectId, edit ?? '');
  useReportView('graph-line', [picked.data && lineItem(picked.data)]);

  // The branch taken at each fork of a route between two picked ends, kept for the tab; nothing is kept until both ends are picked.
  const viaKey = start && end ? `${projectId}.${start}:${end}` : '';
  const [storedVia, setStoredVia] = useStored(STORED.routeVia, viaKey);
  const internalVia = viaKey ? storedVia : '';

  // A saved view's branch taken at a fork shows at once, before the changed view comes back.
  const [pendingVia, setPendingVia] = useState<string>();
  useEffect(() => setPendingVia(undefined), [externalVia]);
  const activeVia = pendingVia ?? (externalVia !== undefined ? externalVia : internalVia);

  const handlePickFork = (forkNodeId: string, targetId: string) => {
    const nextVia = viaWith(activeVia || undefined, forkNodeId, targetId);
    if (view) {
      setPendingVia(nextVia);
      void Promise.resolve(onViaChange?.(nextVia)).catch(() => setPendingVia(undefined));
      return;
    }
    if (viaKey) setStoredVia(nextVia);
    onViaChange?.(nextVia);
  };

  const handleClear = () => {
    if (viaKey) setStoredVia('');
    onClear?.();
  };

  const route = useQuery({ ...q.readingRoute(projectId, { start, end, via: activeVia || undefined }), enabled: Boolean(start && end) });
  // The AI step the details pane shows a request of (as the graph's node pane keeps it).
  const [aiNode, setAiNode] = useState<string>();
  const data = route.data;
  const found = data?.status === 'found' && data.start === start && data.end === end;

  return (
    <Page title={view ? view.label : '새 보기'} flush>
      <HeaderActions>
        {toggle}
        {viewMenu}
        {layoutToggle}
        {!view && start && end && found && onSaved && <SaveRouteButton projectId={projectId} route={{ start, end, ...(activeVia && { via: activeVia }) }} onSaved={onSaved} />}
        {found && data.sequence.length > 0 && <RunDialog projectId={projectId} unitIds={data.sequence.map((line) => line.unitId)} unitsLabel={view ? `보기 "${view.label}"` : '경로 대사'} />}
      </HeaderActions>
      <Stack height="full" minHeight={0} grow overflow="hidden">
        {!view && (
          <GraphEndpointBar
            start={startValue}
            end={endValue}
            step="start"
            picking={false}
            canFind={true}
            busy={route.isFetching}
            status={route.isError ? <Text variant="caption" tone="danger" role="status">경로 확인 실패</Text> : data?.status === 'unreachable' ? <Text variant="caption" tone="muted" role="status">연결되지 않은 구간</Text> : <Text variant="caption" tone="muted">저장 안 한 경로</Text>}
            onBeginPicking={onBeginPicking}
            onClear={handleClear}
          />
        )}
        {route.isError && (
          <Inline shrink={false} gap="condensed" border="bottom" borderColor="default" background="dangerFaint" paddingX="normal" paddingY="condensed" variant="body" tone="danger" role="alert">
            <Text minWidth={0} grow truncate>경로를 확인하지 못했습니다.</Text>
            <Button variant="outline" onClick={() => void route.refetch()}>다시 시도</Button>
          </Inline>
        )}
        {found && data.sequence.length > 0 ? (
          <SplitPane
            id="route-detail"
            fill="height"
            defaultWidth="380px"
            autoActivate={detail && Boolean(edit)}
            pane={detail && edit ? <LineDetail projectId={projectId} unitId={edit} showScene onClose={() => onDetail(false)} aiNode={aiNode} onAiNode={setAiNode} /> : undefined}
          >
          <Stack direction="row" height="full" minHeight={0} grow overflow="hidden" data-testid="reading-route" data-route-nodes={data.nodeIds.length}>
            <GraphScriptSplit
              id="reading-route"
              graph={
                <ReadingRouteGraph
                  key={`${start}:${end}:${activeVia}`}
                  projectId={projectId}
                  stages={data.stages}
                  direction={direction}
                  onDirectionChange={onDirectionChange}
                  routeKey={`${start}:${end}`}
                  edit={edit}
                  onEdit={onEdit}
                />
              }
            >
              <RouteList
                key={`${start}:${end}:${activeVia}`}
                projectId={projectId}
                sequence={data.sequence}
                stages={data.stages}
                routeKey={`${start}:${end}`}
                untranslatedIds={data.untranslatedIds}
                edit={edit}
                onEdit={onEdit}
                forks={data.forks}
                onPickFork={handlePickFork}
                onOpenDetail={(unitId) => {
                  if (unitId !== edit) onEdit(unitId);
                  onDetail(true);
                }}
              />
            </GraphScriptSplit>
          </Stack>
          </SplitPane>
        ) : route.isFetching ? (
          <Inline height="full" justify="center" gap="condensed" variant="body" tone="muted">
            <Spinner /> 경로를 확인하는 중…
          </Inline>
        ) : null}
      </Stack>
    </Page>
  );
}
