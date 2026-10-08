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
    <Page title="전체 대사" flush>
      <LinesView
        projectId={projectId}
        search={search}
        showScene
        onSearch={(next, options) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: options?.replace })}
      />
    </Page>
  );
}
