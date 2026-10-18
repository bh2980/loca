import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/p/$projectId/ai/connections')({
  validateSearch: (raw: Record<string, unknown>): { conn?: string } => ({
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : undefined,
  }),
  component: () => {
    const { projectId } = Route.useParams();
    const search = Route.useSearch();
    return <Navigate to="/p/$projectId/settings/connections" params={{ projectId }} search={search} replace />;
  },
});
