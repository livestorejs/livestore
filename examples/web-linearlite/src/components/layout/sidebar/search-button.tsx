import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { Link, useParams } from '@tanstack/react-router'
import React from 'react'

import { MenuContext } from '../../../app/contexts.ts'
import { useFilterState } from '../../../livestore/queries.ts'

export const SearchButton = () => {
  const [, setFilterState] = useFilterState()
  const { setShowMenu } = React.useContext(MenuContext)!
  const { storeId } = useParams({ from: '/$storeId' })
  const params = React.useMemo(() => ({ storeId }), [storeId])
  const handleClick = React.useCallback(() => {
    setFilterState({ query: null })
    setShowMenu(false)
  }, [setFilterState, setShowMenu])

  return (
    <Link
      to="/$storeId/search"
      params={params}
      aria-label="Open search page"
      onClick={handleClick}
      className="rounded-lg size-8 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800"
    >
      <MagnifyingGlassIcon className="size-4" />
    </Link>
  )
}
