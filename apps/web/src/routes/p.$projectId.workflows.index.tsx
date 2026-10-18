import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, Plus, Trash2 } from 'lucide-react';
import { ANALYSIS_SECTION_LABELS, ANALYSIS_SECTIONS, type AnalysisSection } from '@tw/shared';
import { AiButton } from '@/components/ai-button';
import { EmptyState, DataTable, type ColumnDef, JobStatusBadge, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Badge, Checkbox, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label, RadioGroup, RadioGroupItem, Skeleton, HelpTip } from '@loca/ui';
import { HeaderActions, Page } from '@/components/page';
import { RunDialog } from '@/components/workflow/run-dialog';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { dateTime } from '@/lib/datetime';

export const Route = createFileRoute('/p/$projectId/workflows/')({ component: Workflows });

function Workflows() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const workflows = useQuery(q.workflows(projectId));
  const runs = useQuery(q.runs(projectId));
  const remove = useMutation({ mutationFn: (id: string) => unwrap(client.workflows[':id'].$delete({ param: { id } })) });
  type Workflow = NonNullable<typeof workflows.data>[number];

  const columns: ColumnDef<Workflow, unknown>[] = [
    {
      id: 'name',
      header: '이름',
      meta: { hideable: false },
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: row.original.id }} className="truncate font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
              {row.original.name}
            </Link>
            {row.original.errorCount > 0 && <Badge variant="destructive">오류 {row.original.errorCount}</Badge>}
          </div>
          {row.original.description && <p className="truncate text-xs text-muted-foreground">{row.original.description}</p>}
        </div>
      ),
    },
    { id: 'nodes', header: '노드', meta: { width: 64, align: 'end' }, cell: ({ row }) => row.original.nodeCount },
    {
      id: 'saved',
      header: '저장',
      meta: { width: 120, className: 'text-muted-foreground' },
      cell: ({ row }) => dateTime(row.original.updatedAt),
    },
    {
      id: 'last',
      header: '최근 실행',
      meta: { width: 220 },
      cell: ({ row }) => {
        const last = runs.data?.find((run) => run.workflowId === row.original.id);
        if (!runs.data) return <Skeleton className="h-4 w-24" />;
        if (!last) return <span className="text-muted-foreground">—</span>;
        return (
          <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: last.id }} className="flex items-center gap-2 hover:underline" onClick={(event) => event.stopPropagation()}>
            <JobStatusBadge status={last.status} />
            <span className="truncate text-xs text-muted-foreground">{dateTime(last.createdAt)}</span>
          </Link>
        );
      },
    },
    {
      id: 'run',
      header: () => <span className="sr-only">실행</span>,
      meta: { width: 88, className: 'py-1.5', label: '실행', hideable: false },
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <RunDialog
            projectId={projectId}
            workflowId={row.original.id}
            disabled={row.original.errorCount > 0}
            trigger={
              <Button variant="ghost" disabled={row.original.errorCount > 0}>
                <Play /> 실행
              </Button>
            }
          />
        </div>
      ),
    },
    {
      id: 'delete',
      header: () => <span className="sr-only">삭제</span>,
      meta: { width: 48, className: 'py-1.5', label: '삭제', hideable: false },
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100" aria-label={`${row.original.name} 삭제`}>
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>‘{row.original.name}’을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>지난 실행 기록은 그대로 남습니다(실행 당시 정의를 따로 보관합니다).</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate(row.original.id)}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ),
    },
  ];

  return (
    <Page title="워크플로" flush>
      <div className="flex h-full min-h-0 flex-col">
        <HeaderActions>
          <AiButton send={false} prompt="이런 워크플로를 만들어줘: ">
            AI로 만들기
          </AiButton>
          <NewWorkflow projectId={projectId} />
        </HeaderActions>
        <DataTable id="workflows"
          columns={columns}
          rows={workflows.data}
          rowId={(workflow) => workflow.id}
          loading={workflows.isLoading}
          empty={<EmptyState noun="워크플로" />}
          onRowClick={(workflow) => void navigate({ to: '/p/$projectId/workflows/$workflowId', params: { projectId, workflowId: workflow.id } })}
        />
      </div>
    </Page>
  );
}

type From = 'template' | 'terms' | 'listener' | 'knowledge' | 'speechFix' | 'analysis' | 'blank';

function NewWorkflow({ projectId }: { projectId: string }) {
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState<From>('template');
  // An analysis template reads only the picked sections (all of them when every box is ticked).
  const [sections, setSections] = useState<AnalysisSection[]>([...ANALYSIS_SECTIONS]);
  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].workflows.$post({ param: { projectId }, json: { name: name.trim(), from, ...(from === 'analysis' && sections.length < ANALYSIS_SECTIONS.length ? { sections } : {}) } })),
    onSuccess: (workflow) => {
      setOpen(false);
      void navigate({ to: '/p/$projectId/workflows/$workflowId', params: { projectId, workflowId: workflow.id } });
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> 새 워크플로
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>새 워크플로</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">이름</Label>
            <Input id="wf-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <RadioGroup value={from} onValueChange={(value) => setFrom(value as From)}>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="template" className="mt-0.5" />
              <span>
                기본 번역 템플릿
                <span className="ml-1 inline-flex align-middle"><HelpTip>번역 → 형식 검사 → 검수 → 확정, 실패는 3회 수정 후 ‘사람 확인 필요’(검토함)로</HelpTip></span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="terms" className="mt-0.5" />
              <span>
                용어 추출 템플릿
                <span className="block text-xs text-muted-foreground">장면별로 용어를 뽑아 용어집 후보로 추가 (상태는 그대로). 수락 후 번역에 쓰입니다.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="listener" className="mt-0.5" />
              <span>
                청자 추정 템플릿
                <span className="block text-xs text-muted-foreground">장면별로 대사마다 누구에게 하는 말인지와 확신도를 적습니다 (번역·상태는 그대로). 말투 규칙은 청자가 정해진 대사에만 쓰입니다.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="knowledge" className="mt-0.5" />
              <span>
                자료 갱신 템플릿
                <span className="block text-xs text-muted-foreground">장면을 읽으며 새 인물·관계 변화·사건·말투 변화를 자료에 AI 항목으로 넣습니다 (정식 자료는 그대로, 다른 의견은 후보).</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="analysis" className="mt-0.5" />
              <span>
                작품 분석 템플릿
                <span className="block text-xs text-muted-foreground">대본 전체를 한 번에 읽고 고른 항목만 자료 초안·용어 후보로 넣습니다. 장면을 골라 실행하면 그 장면의 항목을 더하기만 합니다.</span>
              </span>
            </label>
            {from === 'analysis' && (
              <div className="ml-6 grid grid-cols-2 gap-1.5" role="group" aria-label="읽을 항목">
                {ANALYSIS_SECTIONS.map((section) => (
                  <label key={section} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={sections.includes(section)}
                      disabled={sections.length === 1 && sections.includes(section)}
                      onCheckedChange={(checked) => setSections((current) => (checked ? ANALYSIS_SECTIONS.filter((one) => one === section || current.includes(one)) : current.filter((one) => one !== section)))}
                    />
                    {ANALYSIS_SECTION_LABELS[section]}
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="speechFix" className="mt-0.5" />
              <span>
                말투만 고치기 템플릿
                <span className="block text-xs text-muted-foreground">말투 규칙·청자를 고친 뒤, 현재 번역의 어미·호칭만 확정 규칙에 맞춥니다 (뜻·표현·상태는 그대로).</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="blank" className="mt-0.5" />
              <span>
                빈 워크플로
              </span>
            </label>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
