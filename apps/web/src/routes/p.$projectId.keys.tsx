import { createFileRoute, Navigate } from '@tanstack/react-router';
import { param, searchParams } from '@/lib/search';

export const Route = createFileRoute('/p/$projectId/keys')({
  validateSearch: searchParams({ key: param.text }),
  component: () => {
    const { projectId } = Route.useParams();
    const search = Route.useSearch();
    return <Navigate to="/p/$projectId/settings/connections" params={{ projectId }} search={search} replace />;
  },
});
