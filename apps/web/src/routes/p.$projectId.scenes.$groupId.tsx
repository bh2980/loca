import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Network, Play } from 'lucide-react';
import { RunDialog } from '@/components/workflow/run-dialog';
import { LinesView, linesSearchSchema } from '@/components/lines-view';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { GROUP_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';

export const Route = createFileRoute('/p/$projectId/scenes/$groupId')({
  validateSearch: linesSearchSchema,
  component: SceneDetail,
});

function SceneDetail() {
  const { projectId, groupId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const group = useQuery(q.group(groupId));
  useReportView('scene', [group.data && { kind: '장면', id: group.data.id, label: group.data.title }]);

  return (
    <Page
      title={group.data?.title ?? '장면'}
      meta={group.data && [GROUP_KIND[group.data.kind], group.data.key, group.data.description].filter(Boolean).join(' · ')}
      actions={
        <>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/p/$projectId/scenes" params={{ projectId }}>
              <ChevronLeft /> 장면 목록
            </Link>
          </Button>
          <RunDialog
            projectId={projectId}
            groupIds={[groupId]}
            trigger={
              <Button size="sm">
                <Play /> 이 장면 실행
              </Button>
            }
          />
          <Button variant="outline" size="sm" asChild>
            <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: groupId }}>
              <Network /> 대사 그래프에서 보기
            </Link>
          </Button>
        </>
      }
      flush
      className="border-t-0"
    >
      <LinesView projectId={projectId} groupId={groupId} search={search} onSearch={(next, options) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: options?.replace })} />
    </Page>
  );
}
