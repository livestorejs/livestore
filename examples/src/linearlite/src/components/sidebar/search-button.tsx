import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button } from 'react-aria-components'

export const SearchButton = () => {
  return (
    <Button
      aria-label="New Issue"
      className="rounded-lg size-8 flex items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
    >
      <MagnifyingGlassIcon className="size-4" />
    </Button>
  )
}
