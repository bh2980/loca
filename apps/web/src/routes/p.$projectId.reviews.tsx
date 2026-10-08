import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/p/$projectId/reviews')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/p/$projectId/reviews"!</div>
}
