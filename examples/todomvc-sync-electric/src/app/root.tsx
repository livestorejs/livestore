import { Outlet, Scripts } from '@remix-run/react'
import React from 'react'

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
