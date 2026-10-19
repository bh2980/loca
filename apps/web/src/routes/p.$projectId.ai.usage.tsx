import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/p/$projectId/ai/usage')({
  component: () => {
    const { projectId } = Route.useParams();
    return <Navigate to="/p/$projectId/settings/editor" params={{ projectId }} replace />;
  },
});
