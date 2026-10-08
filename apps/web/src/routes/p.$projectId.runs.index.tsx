import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/p/$projectId/runs/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/p/$projectId/runs/"!</div>
}
