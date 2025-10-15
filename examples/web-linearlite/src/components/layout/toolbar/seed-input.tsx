import { PlusIcon } from '@heroicons/react/16/solid'
import { useStore } from '@livestore/react'
import React from 'react'
import { Button, Input } from 'react-aria-components'
import { seed } from '../../../livestore/seed.ts'

export const SeedInput = ({ className }: { className?: string }) => {
  const [count, setCount] = React.useState(50)
  const { store } = useStore()

  const onClick = () => {
    if (count === 0) return
    seed(store, count)
  }

  return (
    <div className={`lg:h-full flex items-center gap-px ${className}`}>
      <Input
        aria-label="Seed count"
        placeholder="123"
        autoComplete="off"
        type="number"
        value={count}
        onChange={(e) => setCount(Number(e.target.value))}
        className="h-6 px-1.5 border-none rounded-l text-xs bg-neutral-800 placeholder:text-neutral-500 text-neutral-300 w-12 focus:outline-none focus:ring-0 focus:border-none hover:bg-neutral-700 focus:bg-neutral-700"
      />
      <Button
        aria-label="Seed database"
        onPress={onClick}
        className="h-6 flex items-center gap-1 pl-1 pr-1.5 bg-neutral-800 rounded-r hover:bg-neutral-700 focus:outline-none focus:bg-neutral-700"
      >
        <PlusIcon className="size-3" />
        <span>Seed</span>
      </Button>
    </div>
  )
}
