import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ITEM_STATE, RUN_STATUS } from '@/lib/labels';
import { q } from '@/lib/queries';

export const Route = createFileRoute('/p/$projectId/runs/')({ component: Runs });

function Runs() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const runs = useQuery(q.runs(projectId));

  return (
    <Page title="실행 기록" description="워크플로 실행마다 당시의 정의와 프로필을 고정해 보관합니다.">
      {runs.data?.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>아직 실행이 없습니다</EmptyTitle>
            <EmptyDescription>워크플로 화면에서 실행을 시작하세요.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>워크플로</TableHead>
                <TableHead className="w-24">상태</TableHead>
                <TableHead className="w-72">진행</TableHead>
                <TableHead className="w-56">대사 상태</TableHead>
                <TableHead className="w-44">시작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data?.map((run) => {
                const finished = (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0);
                return (
                  <TableRow key={run.id} className="cursor-pointer" onClick={() => void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: run.id } })}>
                    <TableCell>
                      <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }} className="font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
                        {run.workflowName}
                      </Link>
                      <span className="ml-1.5 text-xs text-muted-foreground">v{run.workflowVersion}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={run.status === 'running' ? 'default' : 'outline'}>{RUN_STATUS[run.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress value={(finished / run.total) * 100} className="h-1.5" />
                        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {finished}/{run.total}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Object.entries(run.states)
                        .map(([state, count]) => `${ITEM_STATE[state as keyof typeof ITEM_STATE] ?? state} ${count}`)
                        .join(' · ')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Page>
  );
}
