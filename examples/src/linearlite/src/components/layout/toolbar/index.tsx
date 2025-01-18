import { Icon } from '@/components/icons'
import { DownloadButton } from '@/components/layout/toolbar/download-button'
import { ResetButton } from '@/components/layout/toolbar/reset-button'
import { SeedInput } from '@/components/layout/toolbar/seed-input'
import { ShareButton } from '@/components/layout/toolbar/share-button'
import { UserInput } from '@/components/layout/toolbar/user-input'
import { FPSMeter } from '@overengineering/fps-meter'
import React from 'react'
import { Link } from 'react-router-dom'
import { DevtoolsButton } from './devtools-button'
import { SyncToggle } from './sync-toggle'

export const Toolbar = () => {
  return (
    <div className="w-screen h-10 bg-neutral-950 border-t border-neutral-700 text-neutral-400 flex items-center justify-between pl-1 pr-2">
      <div className="flex items-center gap-1">
        <Link
          to="https://livestore.dev/"
          target="_blank"
          className="flex items-center gap-2 text-sm font-bold rounded text-neutral-300 bg-neutral-900 hover:bg-neutral-800 focus:bg-neutral-800 px-1.5 h-6"
        >
          <Icon name="livestore" className="size-5 mt-0.5" />
          <span>LiveStore</span>
        </Link>
        <SyncToggle />
      </div>
      <div className="hidden lg:flex items-center gap-1">
        <UserInput />
        <ShareButton />
      </div>
      <div className="hidden lg:flex items-center gap-1">
        <span>Database:</span>
        <SeedInput />
        <ResetButton />
        <DownloadButton />
        <DevtoolsButton />
      </div>
      <FPSMeter height={28} className="hidden lg:block" />
    </div>
  )
}
