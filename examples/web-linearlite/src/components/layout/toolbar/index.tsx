import React from 'react'
import { Icon } from '../../icons/index.tsx'
import { DevtoolsButton } from './devtools-button.tsx'
import { DownloadButton } from './download-button.tsx'
import { ResetButton } from './reset-button.tsx'
import { SeedInput } from './seed-input.tsx'
import { ShareButton } from './share-button.tsx'
import { SyncToggle } from './sync-toggle.tsx'
import { UserInput } from './user-input.tsx'

const useClientFPSMeter = () => {
  const [Component, setComponent] = React.useState<React.ComponentType<{ height?: number; className?: string }>>(
    () => () => null,
  )

  React.useEffect(() => {
    let active = true
    void import('@overengineering/fps-meter').then(({ FPSMeter }) => {
      if (active) {
        setComponent(() => FPSMeter)
      }
    })

    return () => {
      active = false
    }
  }, [])

  return Component
}

export const Toolbar = () => {
  const FPSMeter = useClientFPSMeter()
  return (
    <div className="w-screen h-10 bg-neutral-950 border-t border-neutral-700 text-neutral-400 flex items-center justify-between pl-1 pr-2">
      <div className="flex items-center gap-1">
        <a
          href="https://livestore.dev/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm font-bold rounded text-neutral-300 bg-neutral-900 hover:bg-neutral-800 focus:bg-neutral-800 px-1.5 h-6"
        >
          <Icon name="livestore" className="size-5 mt-0.5" />
          <span>LiveStore</span>
        </a>
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
        {import.meta.env.DEV && <DevtoolsButton />}
      </div>
      <FPSMeter height={28} className="hidden lg:block" />
    </div>
  )
}
