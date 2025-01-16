import { useFrontendState } from '@/lib/livestore/queries'
import React from 'react'
import { Toolbar } from '../toolbar'

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const [frontendState] = useFrontendState()

  return (
    <div className="h-screen flex flex-col">
      <div className={`flex w-screen grow ${frontendState.showToolbar ? 'h-[calc(100%-4rem)]' : 'h-full'}`}>
        {children}
      </div>
      {frontendState.showToolbar && <Toolbar />}
    </div>
  )
}
