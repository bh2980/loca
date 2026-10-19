import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/p/$projectId/settings/ai-results')({
  component: () => {
    const { projectId } = Route.useParams();
    return <Navigate to="/p/$projectId/settings/agent" params={{ projectId }} replace />;
  },
});
