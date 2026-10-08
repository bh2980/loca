import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/p/$projectId/settings/project')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/p/$projectId/settings/project"!</div>
}
