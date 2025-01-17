import { PlusIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button, Input } from 'react-aria-components'
import { useNavigate } from 'react-router-dom'

export const SeedInput = ({ className }: { className?: string }) => {
  const [seed, setSeed] = React.useState(50)
  const navigate = useNavigate()

  const onClick = () => {
    if (seed === 0) return
    navigate(`/?seed=${seed}`)
    window.location.reload()
  }

  return (
    <div className={`lg:h-full flex items-center lg:border-r lg:border-gray-700 ${className}`}>
      <div className="h-8 border-y border-r border-gray-700 whitespace-nowrap shrink-0 flex items-center px-2 text-sm text-gray-400">
        Seed DB:
      </div>
      <Input
        aria-label="Seed count"
        placeholder="123"
        autoComplete="off"
        type="number"
        value={seed}
        onChange={(e) => setSeed(Number(e.target.value))}
        className="h-8 px-2 border-y !border-x-0 border-gray-700 text-sm placeholder:text-gray-500 text-gray-300 grow w-16 bg-transparent focus:outline-none focus:ring-0 focus:border-gray-700"
      />
      <Button
        aria-label="Seed database"
        onPress={onClick}
        className="h-8 border-l pl-2 pr-2.5 border-y flex items-center gap-1 border-gray-700 text-sm hover:bg-gray-800 focus:outline-none text-gray-400"
      >
        <PlusIcon className="size-3" />
        <span>Seed</span>
      </Button>
    </div>
  )
}
