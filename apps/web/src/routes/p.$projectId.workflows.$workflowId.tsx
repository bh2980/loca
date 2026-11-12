import { useMemo, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ReactFlowProvider } from '@xyflow/react';
import { ChevronRight, Frame, Pencil, Plus } from 'lucide-react';
import { nodeName, exitActions } from '@loca/shared';
import { Page, StatusBarItem } from '@/components/page';
import { EditorPane } from '@/components/workflow/editor-pane';
import { exitKey } from '@/components/workflow/exit-marks';
import { useFlowNames } from '@/components/workflow/flow-canvas';
import { frameId } from '@/components/workflow/frames';
import { WorkflowIssueBar } from '@/components/workflow/issue-bar';
import { nodePalette } from '@/components/workflow/node-palette';
import { RunDialog } from '@/components/workflow/run-dialog';
import { useWorkflowCanvas } from '@/components/workflow/use-workflow-canvas';
import { useWorkflowDraft } from '@/components/workflow/use-workflow-draft';
import { useWorkflowEditing } from '@/components/workflow/use-workflow-editing';
import { useWorkflowLayout } from '@/components/workflow/use-workflow-layout';
import { useWorkflowSelection } from '@/components/workflow/use-workflow-selection';
import { useWorkflowView } from '@/components/workflow/use-workflow-view';
import { WorkflowCanvasView } from '@/components/workflow/workflow-canvas';
import { SplitPane, PageHeading, HeaderActions, NodeLibrary, type CanvasDirection, Box, Button, Icon, Inline, Stack, Text, Input, Skeleton, Popover, PopoverContent, PopoverTrigger } from '@loca/ui';
import { useReportView } from '@/lib/reported-view';
import { param, searchParams } from '@/lib/search';
import { dateTime } from '@/lib/datetime';
import { useWorkflows } from '@/lib/workflows';

/** When the workflow was last saved: 10. 13. 오전 06:16. Runs keep their own copy of what they ran. */
const savedAt = (at: string) => dateTime(at);

/**
 * The workflow's name reads as a title; the pencil turns it into an ordinary field (Enter or
 * leaving keeps it, Esc puts it back). The rename is part of the unsaved edit like any other.
 */
function NameField({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  // Esc closes the field, and the blur that follows must not keep what was typed.
  const cancelled = useRef(false);
  const done = (keep: boolean) => {
    if (!keep) cancelled.current = true;
    if (keep && !cancelled.current && editing?.trim() && editing.trim() !== name) onRename(editing.trim());
    setEditing(null);
  };
  if (editing !== null)
    return (
      <Box asChild height="control" width="menu-lg">
      <Input
        autoFocus
        value={editing}
        onChange={(event) => setEditing(event.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(event) => (event.key === 'Enter' ? done(true) : event.key === 'Escape' && done(false))}
        aria-label="워크플로 이름"
      />
      </Box>
    );
  return (
    <Inline as="span" minWidth={0} gap="hair">
      <Text truncate weight="medium" tone="default">{name}</Text>
      <Button variant="ghost" size="icon-xs" aria-label="이름 바꾸기" onClick={() => ((cancelled.current = false), setEditing(name))}>
        <Pencil />
      </Button>
    </Inline>
  );
}

export const Route = createFileRoute('/p/$projectId/workflows/$workflowId')({
  // A picked node, frame or exit (its pane opens); one thing is picked at a time.
  validateSearch: searchParams({ node: param.text, frame: param.text, exit: param.text, direction: param.oneOf<CanvasDirection>(['horizontal', 'vertical']) }, (search) => ({
    ...search,
    frame: search.node ? undefined : search.frame,
    exit: search.node || search.frame ? undefined : search.exit,
  })),
  component: WorkflowRoute,
});
/** The editor is mounted per workflow: its draft, selection, undo history and measured sizes belong to one workflow. */
function WorkflowRoute() {
  const { workflowId } = Route.useParams();
  return <ReactFlowProvider key={workflowId}><WorkflowEditor /></ReactFlowProvider>;
}

/**
 * The workflow editor. The page puts its parts together: the draft and how it saves (use-workflow-draft), what is
 * selected (use-workflow-selection), the workflow as drawn (use-workflow-view), every edit and its keys
 * (use-workflow-editing), layout and direction (use-workflow-layout), what React Flow draws and reports
 * (use-workflow-canvas, workflow-canvas), and the right pane (editor-pane).
 */
function WorkflowEditor() {
  const { projectId, workflowId } = Route.useParams();
  const surface = useRef<HTMLDivElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const workflows = useWorkflows(projectId);
  const draft = useWorkflowDraft(projectId, workflowId);
  const { workflow, current, issues, save, activeRun, stale } = draft;
  const selection = useWorkflowSelection(current?.definition);
  const direction: CanvasDirection = selection.search.direction ?? current?.definition.direction ?? 'vertical';
  const { names, taxonomy, connections } = useFlowNames(projectId, workflows.data);
  const view = useWorkflowView({ workflowId, definition: current?.definition, direction, setDraft: draft.setDraft, selection });
  const editing = useWorkflowEditing({ workflowId, draft, selection, view, direction });
  const layout = useWorkflowLayout({ workflowId, draft, selection, view, direction, marks: names.marks, canvas: surface });
  const canvas = useWorkflowCanvas({ draft, selection, view, editing, direction, names });
  // The palette offers the core nodes and those of the workflow's input.
  const palette = useMemo(() => (current ? nodePalette(current.definition) : []), [current?.definition]); // eslint-disable-line react-hooks/exhaustive-deps

  const { node: selected, group: pickedGroup, exit: pickedExit, select, nodes: picked } = selection;
  useReportView('workflow', [
    workflow.data && { kind: '워크플로', id: workflow.data.id, label: workflow.data.name },
    selected && { kind: '워크플로 노드', id: selected.id, label: `${nodeName(selected)} (${selected.type})`, detail: `저장 전 설정: ${JSON.stringify(selected.config).slice(0, 5000)}` },
    pickedGroup && { kind: '워크플로 프레임', id: pickedGroup.id, label: pickedGroup.label || '이름 없는 프레임', detail: `노드: ${pickedGroup.nodeIds.join(', ')}` },
    pickedExit && { kind: '워크플로 출구', id: exitKey(pickedExit.node.id, pickedExit.port), label: `${nodeName(pickedExit.node)} · ${pickedExit.port}`, detail: `출구 동작: ${JSON.stringify(exitActions(pickedExit.node, pickedExit.port))}` },
  ]);

  if (!workflow.data || !current)
    return (
      <Page title="워크플로">
        <Skeleton height="placeholder-page" />
      </Page>
    );

  const calledBy = workflow.data.calledBy ?? [];
  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  return (
    <Page title={current.name || '워크플로'} flush>
      <PageHeading>
        <Text asChild variant="caption" tone="muted"><Link to="/p/$projectId/workflows" params={{ projectId }}>워크플로</Link></Text><Icon icon={ChevronRight} size="xs" tone="muted" />
        <NameField name={current.name} onRename={editing.rename} />
        {calledBy.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" tone="muted">워크플로 {calledBy.length}개가 이 워크플로를 부릅니다</Button>
            </PopoverTrigger>
            <Box asChild width="menu-lg" padding="condensed">
            <PopoverContent align="start">
              <Box as="ul" spaceY="hair">
                {calledBy.map((caller) => (
                  <li key={caller.id}>
                    <Button variant="ghost" width="full" justifyContent="start" weight="normal" asChild>
                      <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: caller.id }}><Text truncate>{caller.name}</Text></Link>
                    </Button>
                  </li>
                ))}
              </Box>
            </PopoverContent>
            </Box>
          </Popover>
        )}
        <Text truncate variant="caption" tone="muted" role="status">{save.isPending ? '저장 중…' : save.isError ? '저장 실패 · 편집 보관됨' : draft.draft ? '저장 대기' : `자동 저장됨 ${savedAt(workflow.data.updatedAt)}`}</Text>
      </PageHeading>
      <HeaderActions>
        {/* The palette, out of the canvas's way: search it, click a node to add it, or drag one onto the canvas. */}
        <Popover open={libraryOpen} onOpenChange={setLibraryOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline"><Plus /> 노드</Button>
          </PopoverTrigger>
          <PopoverContent align="end" padding="none" width="menu-lg">
            <NodeLibrary variant="menu" groups={palette} onSelect={(item) => { editing.addFromLibrary(item.id); setLibraryOpen(false); }} onDragStart={() => window.setTimeout(() => setLibraryOpen(false))} />
          </PopoverContent>
        </Popover>
        <Button variant={editing.drawingFrame ? 'secondary' : 'outline'} aria-pressed={editing.drawingFrame} title={picked.picked.size ? '고른 노드를 새 프레임으로 묶습니다' : '캔버스에 끌어서 프레임을 그립니다 (한 번 누르면 그 자리에 추가)'} onClick={editing.addFramePressed}><Frame /> 프레임</Button>
        <RunDialog projectId={projectId} workflowId={workflowId} disabledReason={save.isPending ? '저장하는 중입니다.' : errorCount > 0 && `오류 ${errorCount}개를 고친 뒤 실행할 수 있습니다. 위의 고치기를 누르세요.`} dirty={Boolean(draft.draft)} />
        {draft.draft && <Button variant="ghost" disabled={save.isPending} onClick={draft.discard}>되돌리기</Button>}
      </HeaderActions>
      {save.isError && <Inline role="alert" gap="condensed" border="bottom" background="dangerSoft" paddingX="comfortable" paddingY="condensed" variant="caption" tone="danger">저장하지 못했습니다. 편집은 이 브라우저에 보관됩니다. {save.error.message}<Button variant="outline" disabled={stale || !draft.draft} onClick={() => draft.draft && save.mutate(draft.draft)}>다시 저장</Button></Inline>}
      {stale && !save.isPending && (
        <Inline gap="normal" border="bottom" background="warningSoft" paddingX="spacious" paddingY="condensed" variant="body" tone="warning">
          편집하는 동안 다른 곳에서 이 워크플로를 저장했습니다({savedAt(workflow.data.updatedAt)}). 이 편집은 그 전 내용을 바탕으로 합니다.
          <Button variant="outline" onClick={draft.discard}>
            최신 불러오기
          </Button>
        </Inline>
      )}
      <WorkflowIssueBar issues={issues} nodes={current.definition.nodes} onFix={select} />
      {/* The editor only edits: how a run is going is on its own page (실행 기록 › 그래프). */}
      {activeRun && (
        <Inline role="status" gap="normal" border="bottom" background="sunken" paddingX="comfortable" paddingY="condensed" variant="caption" tone="muted">
          이 워크플로가 {activeRun.status === 'paused' ? '멈춘 채 실행 중' : '실행 중'}입니다. 실행이 끝날 때까지 바뀐 내용은 저장되지 않고 이 브라우저에 보관됩니다.
          <Button variant="outline" asChild>
            <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: activeRun.id }} search={{ tab: 'graph' }}>진행 보기</Link>
          </Button>
        </Inline>
      )}
      <SplitPane
        fill="height"
        id="workflow"
        selectionKey={selected?.id ?? (pickedGroup && frameId(pickedGroup.id))}
        defaultWidth="360px"
        // Picked nodes (a box, ⌘/Ctrl+click) have no pane; with nothing open the pane is the workflow's settings.
        pane={(selected || pickedExit || pickedGroup || !picked.picked.size) && <EditorPane projectId={projectId} workflowId={workflowId} definition={current.definition} issues={issues} selection={selection} editing={editing} statuses={taxonomy.statuses ?? []} tags={taxonomy.tags} connections={connections.data ?? []} workflows={workflows.data} />}
      >
        <Stack direction="row" minHeight={0} grow paddingBottom="statusBar">
          <WorkflowCanvasView projectId={projectId} workflowId={workflowId} definition={current.definition} direction={direction} palette={palette} surface={surface} selection={selection} view={view} editing={editing} canvas={canvas} layout={layout} />
        </Stack>
      </SplitPane>
      <StatusBarItem>
        <Text marginRight="normal" nowrap tabular>노드 {view.definitions.length}</Text>
        {issues.length > 0 && <Text tone={errorCount ? 'danger' : 'warning'}>{errorCount ? `오류 ${errorCount}` : `경고 ${issues.length}`} · {issues[0]?.message}</Text>}
      </StatusBarItem>
    </Page>
  );
}
