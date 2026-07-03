import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexRoute,
})

function IndexRoute() {
  return (
    <div className="card">
      <h1>Explicit client-document initialization APIs</h1>
      <p>
        This app compares boot, Suspense boundary, Suspense hook, route loader, and derived-readiness patterns.
      </p>
      <p>
        Start with <Link to="/client-only/boot-ensure">boot ensure</Link> or open the sections from the sidebar.
      </p>
    </div>
  )
}
