import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/p/$projectId/knowledge')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/p/$projectId/knowledge"!</div>
}
