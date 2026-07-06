import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexRoute,
})

function IndexRoute() {
  return (
    <div>
      <header className="page-header">
        <h1>Explicit client-only event initialization APIs</h1>
      </header>
      <section className="pattern-note">
        <p>
          This app compares store boot, render hook, route loader, and derived-readiness patterns for explicit
          client-only SQLite row initialization.
        </p>
        <p>
          Start with <Link to="/client-only/store-boot">Store boot</Link> or open the sections from the sidebar.
        </p>
      </section>
    </div>
  )
}
