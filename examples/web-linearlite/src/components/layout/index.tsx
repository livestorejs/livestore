import type React from 'react'
import { useFrontendState } from '../../livestore/queries.ts'
import { MobileMenu } from './sidebar/mobile-menu.tsx'
import { Toolbar } from './toolbar/index.tsx'

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const [frontendState] = useFrontendState()

  return (
    <div className="h-full flex flex-col">
      <div className={`relative flex w-screen grow ${frontendState.showToolbar ? 'h-[calc(100%-3.5rem)]' : 'h-full'}`}>
        {children}
      </div>
      {frontendState.showToolbar && <Toolbar />}
      <MobileMenu />
    </div>
  )
}
