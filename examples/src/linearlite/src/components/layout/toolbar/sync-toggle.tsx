import React from 'react'
import { Switch } from 'react-aria-components'

export const SyncToggle = ({ className }: { className?: string }) => {
  // TODO hook up actual sync/network state
  const [sync, setSync] = React.useState(false)

  return (
    <div
      className={`lg:h-full flex items-center lg:border-r lg:border-neutral-700 text-sm text-neutral-400 ${className}`}
    >
      <Switch
        aria-label="Toggle sync/network"
        isSelected={sync}
        onChange={setSync}
        className="group flex items-center gap-2 h-8 border-t lg:border-b w-full lg:w-auto border-neutral-700 pl-1.5 pr-2.5 hover:bg-neutral-800 focus:outline-none focus:bg-neutral-800 cursor-pointer"
      >
        <div className="h-5 p-px w-8 bg-neutral-700 border rounded-md border-neutral-600 group-data-[selected]:bg-orange-500 group-data-[selected]:border-orange-500 transition-colors">
          <span className="block size-4 bg-white rounded group-data-[selected]:translate-x-3 transition-transform border border-neutral-100 group-data-[selected]:border-orange-100" />
        </div>
        <span>
          Sync<span className="hidden xl:inline">/Network</span>
        </span>
      </Switch>
    </div>
  )
}
