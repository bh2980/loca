import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/p/$projectId/glossary')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/p/$projectId/glossary"!</div>
}
