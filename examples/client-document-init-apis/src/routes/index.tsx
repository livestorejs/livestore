import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexRoute,
})

function IndexRoute() {
  return (
    <div>
      <header className="page-header">
        <h1>Explicit client-document initialization APIs</h1>
      </header>
      <section className="pattern-note">
        <p>
          This app compares boot, Suspense boundary, Suspense hook, route loader, component guard, and
          derived-readiness patterns.
        </p>
        <p>
          Start with <Link to="/client-only/suspense-store-boot">Suspense Store Boot</Link> or open the
          sections from the sidebar.
        </p>
      </section>
    </div>
  )
}
