import { ArrowDownIcon } from '@heroicons/react/16/solid'
import { Button } from 'react-aria-components'

import { useAppStore } from '../../../livestore/store.ts'

export const DownloadButton = ({ className }: { className?: string }) => {
  const store = useAppStore()
  const onClick = () => {
    ;(store as any)._dev.downloadDb()
  }

  return (
    <div className={`lg:h-full flex items-center ${className}`}>
      <Button
        aria-label="Download database"
        onPress={onClick}
        className="h-6 px-1.5 flex items-center gap-1 bg-neutral-800 rounded hover:bg-neutral-700 focus:outline-none focus:bg-neutral-700"
      >
        <ArrowDownIcon className="size-3 shrink-0" />
        <span>Download</span>
      </Button>
    </div>
  )
}
