import { Shortcut } from '@/components/common/shortcut'
import { SortingDirection, SortingOption, sortingOptions } from '@/data/sorting-options'
import { useFilterState } from '@/lib/livestore/queries'
import { ArrowsUpDownIcon, BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { Button, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from 'react-aria-components'

export const SortMenu = ({ type, children }: { type?: 'status' | 'priority'; children?: React.ReactNode }) => {
  const [filterState, setFilterState] = useFilterState()

  const toggleSorting = (sortingOption: SortingOption) => {
    const currentSorting = filterState.orderBy
    const currentDirection = filterState.orderDirection
    if (currentSorting === sortingOption)
      setFilterState((state) => ({ ...state, orderDirection: currentDirection === 'asc' ? 'desc' : 'asc' }))
    else
      setFilterState((state) => ({
        ...state,
        orderBy: sortingOption,
        orderDirection: sortingOptions[sortingOption as SortingOption].defaultDirection as SortingDirection,
      }))
  }

  return (
    <MenuTrigger>
      <Button
        aria-label="Select sorting"
        className="relative group h-6 min-w-6 rounded-lg flex gap-1.5 px-1.5 items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100 text-xs font-medium"
      >
        <ArrowsUpDownIcon className="size-3.5" />
        <span>Sort</span>
        <div className="size-2 rounded-full bg-orange-500 absolute -right-1 top-0" />
      </Button>
      <Popover className="w-48 bg-white rounded-lg shadow-md border border-gray-200 text-sm leading-none">
        <Menu className="focus:outline-none" selectionMode="multiple">
          {type !== 'priority' && (
            <MenuSection key="status" className="p-2">
              <Header className="p-2 text-2xs uppercase font-medium tracking-wide text-gray-400">Sorting</Header>
              {Object.entries(sortingOptions).map(([sortingOption, { name, shortcut }]) => {
                return (
                  <MenuItem
                    key={sortingOption}
                    onAction={() => toggleSorting(sortingOption as SortingOption)}
                    className="group/item p-2 rounded-md flex items-center gap-2 hover:bg-gray-100 focus:outline-none focus:bg-gray-100 cursor-pointer"
                  >
                    <span>{name}</span>
                    {filterState.orderBy === sortingOption && (
                      <>
                        <div className="absolute right-10">
                          {filterState.orderDirection === 'asc' && <BarsArrowDownIcon className="size-4" />}
                          {filterState.orderDirection === 'desc' && <BarsArrowUpIcon className="size-4" />}
                        </div>
                      </>
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
