import { ToolbarContext } from '@/app/provider'
import React from 'react'
import { Toolbar } from '../toolbar'

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { showToolbar } = React.useContext(ToolbarContext)!

  return (
    <div className="h-screen flex flex-col">
      <div className="flex w-screen grow">{children}</div>
      {showToolbar && <Toolbar />}
    </div>
  )
}
