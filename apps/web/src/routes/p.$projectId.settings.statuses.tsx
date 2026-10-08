import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/p/$projectId/settings/statuses')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/p/$projectId/settings/statuses"!</div>
}
