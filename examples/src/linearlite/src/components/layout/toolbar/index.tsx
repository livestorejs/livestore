import { Icon } from '@/components/icons'
import { DownloadButton } from '@/components/layout/toolbar/download-button'
import { MobileMenu } from '@/components/layout/toolbar/mobile-menu'
import { ResetButton } from '@/components/layout/toolbar/reset-button'
import { SeedInput } from '@/components/layout/toolbar/seed-input'
import { ShareButton } from '@/components/layout/toolbar/share-button'
import { UserInput } from '@/components/layout/toolbar/user-input'
import { FPSMeter } from '@overengineering/fps-meter'
import React from 'react'
import { Link } from 'react-router-dom'
import { SyncToggle } from './sync-toggle'

export const Toolbar = () => {
  return (
    <div className="w-screen h-12 bg-neutral-950 border-t border-neutral-700 flex items-center">
      <div className="h-8 border-y border-neutral-700 w-2" />
      <div className="h-full flex items-center border-x border-neutral-700">
        <Link
          to="https://livestore.dev/"
          target="_blank"
          className="flex items-center gap-2 text-sm font-bold text-neutral-300 hover:bg-neutral-800 px-2 border-y border-neutral-700 h-8"
        >
          <Icon name="livestore" className="size-5 mt-1" />
          <span>LiveStore</span>
        </Link>
      </div>
      <UserInput className="hidden lg:flex" />
      <SeedInput className="hidden lg:flex" />
      <ResetButton className="hidden lg:flex" />
      <DownloadButton className="hidden lg:flex" />
      <ShareButton className="hidden lg:flex" />
      <SyncToggle className="hidden lg:flex" />
      <div className="grow h-8 border-y border-neutral-700" />
      <div className="h-full hidden lg:flex items-center border-x border-neutral-700">
        <FPSMeter height={32} />
      </div>
      <MobileMenu />
      <div className="h-8 border-y border-neutral-700 w-2" />
    </div>
  )
}
