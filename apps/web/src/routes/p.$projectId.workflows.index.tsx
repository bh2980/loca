import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { AiButton } from '@/components/ai-button';
import { Page } from '@/components/page';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { RUN_STATUS } from '@/lib/labels';

export const Route = createFileRoute('/p/$projectId/workflows/')({ component: Workflows });

function Workflows() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const workflows = useQuery(q.workflows(projectId));
  const runs = useQuery(q.runs(projectId));
  const remove = useMutation({ mutationFn: (id: string) => unwrap(client.workflows[':id'].$delete({ param: { id } })) });

  return (
    <Page
      title="워크플로"
      actions={
        <>
          <AiButton send={false} prompt="이런 워크플로를 만들어줘: ">
            AI로 만들기
          </AiButton>
          <NewWorkflow projectId={projectId} />
        </>
      }
    >
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead className="w-20">버전</TableHead>
              <TableHead className="w-20 text-right">노드</TableHead>
              <TableHead className="w-28">검사</TableHead>
              <TableHead className="w-48">최근 실행</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.data?.map((workflow) => {
              const last = runs.data?.find((run) => run.workflowId === workflow.id);
              return (
                <TableRow key={workflow.id} className="cursor-pointer" onClick={() => void navigate({ to: '/p/$projectId/workflows/$workflowId', params: { projectId, workflowId: workflow.id } })}>
                  <TableCell>
                    <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: workflow.id }} className="font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
                      {workflow.name}
                    </Link>
                    {workflow.description && <p className="truncate text-xs text-muted-foreground">{workflow.description}</p>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">v{workflow.version}</TableCell>
                  <TableCell className="text-right tabular-nums">{workflow.nodeCount}</TableCell>
                  <TableCell>{workflow.errorCount ? <Badge variant="destructive">오류 {workflow.errorCount}</Badge> : <Badge variant="outline">실행 가능</Badge>}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {last ? (
                      <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: last.id }} className="hover:underline" onClick={(event) => event.stopPropagation()}>
                        {RUN_STATUS[last.status]} · {new Date(last.createdAt).toLocaleString()}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`${workflow.name} 삭제`}>
                          <Trash2 />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>‘{workflow.name}’을 삭제할까요?</AlertDialogTitle>
                          <AlertDialogDescription>지난 실행 기록은 그대로 남습니다(실행 당시 정의를 따로 보관합니다).</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>취소</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove.mutate(workflow.id)}>삭제</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Page>
  );
}

function NewWorkflow({ projectId }: { projectId: string }) {
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState<'template' | 'terms' | 'review' | 'blank'>('template');
  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].workflows.$post({ param: { projectId }, json: { name: name.trim(), from } })),
    onSuccess: (workflow) => {
      setOpen(false);
      void navigate({ to: '/p/$projectId/workflows/$workflowId', params: { projectId, workflowId: workflow.id } });
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
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
          <RadioGroup value={from} onValueChange={(value) => setFrom(value as 'template' | 'terms' | 'review' | 'blank')}>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="template" className="mt-0.5" />
              <span>
                기본 번역 템플릿
                <span className="block text-xs text-muted-foreground">번역 → 형식 검사 → 검수 → 확정, 실패는 3회 수정 후 사람 확인</span>
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
              <RadioGroupItem value="review" className="mt-0.5" />
              <span>
                사람 검토 템플릿
                <span className="block text-xs text-muted-foreground">‘사람 확인 필요’ 상태의 대사를 검토함으로 보내고, 확정 / 다시 번역 / 보류 버튼으로 다음 상태를 정합니다.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="blank" className="mt-0.5" />
              <span>
                빈 워크플로
                <span className="block text-xs text-muted-foreground">진입과 종료만 있는 상태에서 시작</span>
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
