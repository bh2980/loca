import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/p/$projectId/workflows/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/p/$projectId/workflows/"!</div>
}
