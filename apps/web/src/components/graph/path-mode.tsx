import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookmarkPlus } from 'lucide-react';
import { viaWith } from '@loca/shared';
import { HeaderActions, Page } from '@/components/page';
import { ReadingRouteGraph } from '@/components/graph/reading-route-graph';
import { RouteList } from '@/components/graph/route-list';
import { useViewActions } from '@/components/graph/view-inspector';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Box, Button, CanvasDirectionControl, GraphEndpointBar, GraphScriptSplit, Icon, Inline, Input, Popover, PopoverContent, PopoverTrigger, Spinner, Stack, Text } from '@loca/ui';
import type { GraphEndpointStep } from '@loca/ui';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/reported-view';
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
export function PathMode({ projectId, toggle, viewMenu, layoutToggle, view, start, end, via: externalVia, onViaChange, direction, onDirectionChange, edit, onBeginPicking, onClear, onEdit, onSaved }: {
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
  onBeginPicking?: (step: GraphEndpointStep) => void;
  onClear?: () => void;
  onEdit: (unitId: string | undefined) => void;
  /** A route not saved yet was saved as this view. */
  onSaved?: (id: string) => void;
}) {
  const { start: startValue, end: endValue } = useRouteEndpoints(projectId, { start, end });
  const reportEndpoint = (value: { id: string; label: string } | undefined, role: GraphEndpointStep) =>
    value && ({ kind: role === 'start' ? '경로 시작' : '경로 끝', id: value.id, label: value.label, detail: JSON.stringify({ nodeId: value.id }) });
  useReportView('reading-route', [reportEndpoint(startValue, 'start'), reportEndpoint(endValue, 'end')]);

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
  const data = route.data;
  const found = data?.status === 'found' && data.start === start && data.end === end;

  return (
    <Page title={view ? view.label : '새 보기'} flush>
      <HeaderActions>
        {toggle}
        {viewMenu}
        {layoutToggle}
        <CanvasDirectionControl direction={direction} onDirectionChange={onDirectionChange} />
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
              />
            </GraphScriptSplit>
          </Stack>
        ) : route.isFetching ? (
          <Inline height="full" justify="center" gap="condensed" variant="body" tone="muted">
            <Spinner /> 경로를 확인하는 중…
          </Inline>
        ) : null}
      </Stack>
    </Page>
  );
}
