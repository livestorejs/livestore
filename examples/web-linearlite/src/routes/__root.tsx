import '../app/init-theme.ts'
import '../app/style.css'

import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type React from 'react'

const RootDocument = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <link rel="stylesheet" href="/src/app/style.css" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <meta name="description" content="LinearLite clone using React & TailwindJS" />
        <link rel="icon" type="image/svg+xml" href="/favicon.ico" />
        <title>LinearLite</title>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

const RootComponent = () => {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
