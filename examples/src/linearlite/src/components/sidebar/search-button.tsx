import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Link } from 'react-router-dom'

export const SearchButton = () => {
  return (
    <Link
      to="/search"
      aria-label="Open search page"
      className="rounded-lg size-8 flex items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
    >
      <MagnifyingGlassIcon className="size-4" />
    </Link>
  )
}
