import 'todomvc-app-css/index.css'

import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react'
import React from 'react'

// export const Layout = ({ children }: { children: React.ReactNode }) => {
//   return (
//     <html lang="en">
//       <head>
//         <meta charSet="utf-8" />
//         <meta name="viewport" content="width=device-width, initial-scale=1" />
//         <title>TodoMVC with ElectricSQL</title>
//         <Meta />
//         <Links />
//       </head>
//       <body>
//         {children}
//         <ScrollRestoration />
//         <Scripts />
//       </body>
//     </html>
//   )
// }

export const HydrateFallback = () => {
  return (
    <>
      <p>Loading...</p>
      <Scripts />
    </>
  )
}

const App = () => {
  return (
    <>
      <Outlet />
      <Scripts />
    </>
  )
}

export default App
