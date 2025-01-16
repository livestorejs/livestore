import { useFilterState } from '@/lib/livestore/queries'
import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { XMarkIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { useKeyboard } from 'react-aria'
import { Button, Input } from 'react-aria-components'

export const SearchBar = () => {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [filterState, setFilterState] = useFilterState()

  const { keyboardProps } = useKeyboard({
    onKeyDown: (e) => {
      if (e.key === 'Escape') (e.target as HTMLInputElement)?.blur()
    },
  })

  return (
    <div className="h-12 relative border-b border-gray-200 flex items-center text-sm pl-6 pr-2">
      <MagnifyingGlassIcon className="size-4" />
      <Input
        type="text"
        autoFocus
        className="input w-full border-none focus:outline-none focus:ring-0 placholder:text-gray-400 text-gray-800 text-sm"
        value={filterState.query ?? ''}
        placeholder="Search issues..."
        onChange={(e) => setFilterState((state) => ({ ...state, query: e.target.value }))}
        {...keyboardProps}
      />
      {filterState.query && (
        <Button
          aria-label="Clear search query"
          onPress={() => setFilterState((state) => ({ ...state, query: undefined }))}
          className="absolute right-2 size-8 rounded-lg hover:bg-gray-100 focus:bg-gray-100 flex items-center justify-center"
        >
          <XMarkIcon className="size-5" />
        </Button>
      )}
    </div>
  )
}
