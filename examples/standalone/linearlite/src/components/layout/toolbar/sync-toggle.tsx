import React from 'react'
import { Switch } from 'react-aria-components'

export const SyncToggle = ({ className }: { className?: string }) => {
  // TODO hook up actual sync/network state
  const [sync, setSync] = React.useState(false)

  return (
    <div className={`flex items-center ${className}`}>
      {/* TODO add disabled tooltip for now */}
      <Switch
        aria-label="Toggle sync/network"
        isSelected={sync}
        onChange={setSync}
        isDisabled={true} // TODO enable when sync is implemented
        className="group flex h-6 items-center gap-2 bg-neutral-800 hover:bg-neutral-700 rounded pl-1 pr-1.5 focus:outline-none focus:bg-neutral-700 cursor-pointer"
      >
        <div className="h-4 p-px w-6 bg-neutral-600 rounded-full group-data-[selected]:bg-orange-500 transition-colors">
          <span className="block size-3.5 bg-white rounded-full group-data-[selected]:translate-x-2 transition-transform" />
        </div>
        <span>
          Sync<span className="hidden xl:inline">/Network</span>
        </span>
      </Switch>
    </div>
  )
}
