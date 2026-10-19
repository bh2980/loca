import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/p/$projectId/keys')({
  validateSearch: (raw: Record<string, unknown>): { key?: string } => ({
    key: typeof raw.key === 'string' && raw.key ? raw.key : undefined,
  }),
  component: () => {
    const { projectId } = Route.useParams();
    const search = Route.useSearch();
    return <Navigate to="/p/$projectId/settings/connections" params={{ projectId }} search={search} replace />;
  },
});
