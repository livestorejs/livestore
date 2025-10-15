import { ArrowsUpDownIcon, BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { useKeyboard } from 'react-aria'
import { Button, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from 'react-aria-components'
import { type SortingDirection, type SortingOption, sortingOptions } from '../../../data/sorting-options.ts'
import { useFilterState } from '../../../livestore/queries.ts'
import { Shortcut } from '../../common/shortcut.tsx'

export const SortMenu = ({ type }: { type?: 'status' | 'priority' }) => {
  const [filterState, setFilterState] = useFilterState()
  const [isOpen, setIsOpen] = React.useState(false)

  const toggleSorting = (sortingOption: SortingOption) => {
    const currentSorting = filterState.orderBy
    const currentDirection = filterState.orderDirection
    if (currentSorting === sortingOption)
      setFilterState({ orderDirection: currentDirection === 'asc' ? 'desc' : 'asc' })
    else
      setFilterState({
        orderBy: sortingOption,
        orderDirection: sortingOptions[sortingOption as SortingOption].defaultDirection as SortingDirection,
      })
  }

  const { keyboardProps } = useKeyboard({
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        return
      }
      Object.entries(sortingOptions).forEach(([sortingOption, { shortcut }]) => {
        if (e.key === shortcut) {
          toggleSorting(sortingOption as SortingOption)
          return
        }
      })
    },
  })

  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        aria-label="Select sorting"
        className="relative group h-6 min-w-6 rounded-lg flex gap-1.5 px-1.5 items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 text-xs font-medium"
      >
        <ArrowsUpDownIcon className="size-3.5" />
        <span>Sort</span>
        <div className="size-1.5 rounded-full bg-orange-500 absolute -right-0.5 top-0" />
      </Button>
      <Popover className="w-48 bg-white dark:bg-neutral-800 rounded-lg shadow-md border border-neutral-200 dark:border-neutral-700 text-sm leading-none">
        <Menu className="focus:outline-none" selectionMode="multiple" {...keyboardProps}>
          {type !== 'priority' && (
            <MenuSection key="status" className="p-2">
              <Header className="p-2 text-2xs uppercase font-medium tracking-wide text-neutral-400">Sorting</Header>
              {Object.entries(sortingOptions).map(([sortingOption, { name, shortcut }]) => {
                return (
                  <MenuItem
                    key={sortingOption}
                    onAction={() => toggleSorting(sortingOption as SortingOption)}
                    className="group/item p-2 rounded-md flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-700 cursor-pointer"
                  >
                    <span>{name}</span>
                    {filterState.orderBy === sortingOption && (
                      <div className="absolute right-10">
                        {filterState.orderDirection === 'asc' && <BarsArrowDownIcon className="size-4" />}
                        {filterState.orderDirection === 'desc' && <BarsArrowUpIcon className="size-4" />}
                      </div>
                    )}
                    <Shortcut keys={[shortcut]} className="absolute right-3" />
                  </MenuItem>
                )
              })}
            </MenuSection>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
