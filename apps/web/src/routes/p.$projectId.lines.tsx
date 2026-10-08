import { createFileRoute } from '@tanstack/react-router';
import { LinesView, linesSearchSchema } from '@/components/lines-view';
import { Page } from '@/components/page';

export const Route = createFileRoute('/p/$projectId/lines')({
  validateSearch: linesSearchSchema,
  component: AllLines,
});

function AllLines() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Page title="전체 대사" description="프로젝트의 모든 대사. 검색과 필터는 주소에 남아 뒤로 가기로 돌아올 수 있습니다." flush className="border-t-0">
      <LinesView
        projectId={projectId}
        search={search}
        showScene
        onSearch={(next, options) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: options?.replace })}
      />
    </Page>
  );
}
