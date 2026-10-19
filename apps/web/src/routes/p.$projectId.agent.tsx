import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/p/$projectId/agent')({
  component: () => {
    const { projectId } = Route.useParams();
    return <Navigate to="/p/$projectId/settings/agent" params={{ projectId }} replace />;
  },
});
