import { MenuButton } from '@/components/common/menu-button'
import { useFilterState } from '@/lib/livestore/queries'
import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { XMarkIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { useKeyboard } from 'react-aria'
import { Button, Input } from 'react-aria-components'

export const SearchBar = () => {
  const [filterState, setFilterState] = useFilterState()

  const { keyboardProps } = useKeyboard({
    onKeyDown: (e) => {
      if (e.key === 'Escape') (e.target as HTMLInputElement)?.blur()
    },
  })

  return (
    <div className="h-12 shrink-0 relative border-b border-neutral-200 dark:border-neutral-700 flex items-center text-sm p-2 lg:pl-6">
      <MenuButton className="lg:hidden" />
      <MagnifyingGlassIcon className="size-4 shrink-0 ml-2.5 lg:ml-0" />
      <Input
        type="text"
        autoFocus
        className="input w-full border-none pl-2 lg:pl-3 bg-transparent focus:outline-none focus:ring-0 placholder:text-neutral-400 dark:placeholder:text-neutral-500 dark:text-neutral-200 text-neutral-800 text-sm"
        value={filterState.query ?? ''}
        placeholder="Search issues..."
        onChange={(e) => setFilterState((state) => ({ ...state, query: e.target.value }))}
        {...keyboardProps}
      />
      {filterState.query && (
        <Button
          aria-label="Clear search query"
          onPress={() => setFilterState((state) => ({ ...state, query: undefined }))}
          className="absolute right-2 size-8 rounded-lg hover:bg-neutral-100 focus:bg-neutral-100 flex items-center justify-center"
        >
          <XMarkIcon className="size-5" />
        </Button>
      )}
    </div>
  )
}
