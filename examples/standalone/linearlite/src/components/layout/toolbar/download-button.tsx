import { ArrowDownIcon } from '@heroicons/react/16/solid'
import { useStore } from '@livestore/react'
import React from 'react'
import { Button } from 'react-aria-components'

export const DownloadButton = ({ className }: { className?: string }) => {
  const { store } = useStore()
  const onClick = () => {
    store.__devDownloadDb()
  }

  return (
    <div className={`lg:h-full flex items-center lg:border-r lg:border-gray-700 ${className}`}>
      <Button
        aria-label="Download database"
        onPress={onClick}
        className="h-8 pl-2 pr-2.5 w-full lg:w-auto lg:border-y flex items-center whitespace-nowrap gap-1 border-gray-700 text-sm hover:bg-gray-800 focus:outline-none text-gray-400"
      >
        <ArrowDownIcon className="size-3 shrink-0" />
        <span>
          Download<span className="hidden xl:inline"> DB</span>
        </span>
      </Button>
    </div>
  )
}
