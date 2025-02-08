import { MobileMenu } from '@/components/layout/sidebar/mobile-menu'
import { Toolbar } from '@/components/layout/toolbar'
import { useFrontendState } from '@/lib/livestore/queries'
import React from 'react'

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
