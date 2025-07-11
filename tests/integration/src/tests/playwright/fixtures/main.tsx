import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from '@tanstack/react-router'
import React from 'react'
import ReactDOM from 'react-dom/client'

const NoLivestore = () => {
  return <div>No Livestore</div>
}

const DynamicIndexHtml = () => {
  React.useEffect(() => {
    const main = async () => {
      const modules = import.meta.glob('../**/*.ts')

      const searchParams = new URLSearchParams(window.location.search)
      const importPath = searchParams.get('importPath')
      const exportName = searchParams.get('exportName')
      if (importPath === null || exportName === null) {
        throw new Error('importPath and exportName must be provided')
      }
      if (modules[importPath] === undefined) {
        throw new Error(`Module not found: ${importPath}.\n\nAvailable modules:\n${Object.keys(modules).join('\n')}\n`)
      }

      const module: any = await modules[importPath]()
      await module[exportName]()
    }

    main().catch((error) => console.error(error))
  }, [])

  return null
}

const rootRoute = createRootRoute({ component: Outlet })

const routes = [
  {
    path: '/dynamic-index-html',
    component: DynamicIndexHtml,
  },
  {
    path: '/devtools/two-stores',
    component: React.lazy(() => import('./devtools/two-stores/Root.tsx').then((m) => ({ default: m.Root }))),
  },
  {
    path: '/devtools/todomvc',
    component: React.lazy(() => import('./devtools/todomvc/Root.tsx').then((m) => ({ default: m.App }))),
  },
  {
    path: '/devtools/no-livestore',
    component: NoLivestore,
  },
]

const Home = () => {
  return (
    <div>
      <h1>Home</h1>
      <ul>
        {routes.map((route) => (
          <li key={route.path}>
            <Link to={route.path}>{route.path}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: Home,
  }),
  ...routes.map((route) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: route.path,
      component: route.component,
    }),
  ),
])

const router = createRouter({ routeTree })

// Type augmentation for the router instance (recommended by docs)
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root')
if (rootElement !== null && rootElement !== undefined) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  )
} else {
  console.error('Could not find root element to mount to!')
}
