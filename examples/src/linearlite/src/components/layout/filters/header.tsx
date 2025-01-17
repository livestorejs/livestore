import { MenuButton } from '@/components/common/menu-button'
import React from 'react'

export const Header = ({
  totalCount,
  filteredCount,
  heading,
}: {
  totalCount: number
  filteredCount: number
  heading: string
}) => {
  return (
    <div className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 text-sm pl-2 lg:pl-6">
      <MenuButton className="lg:hidden" />
      <div className="font-medium ml-1 lg:ml-0">{heading}</div>
      <div className="text-gray-500 dark:text-gray-400">
        <span>{filteredCount}</span>
        {filteredCount !== totalCount && <span> of {totalCount}</span>}
        {heading !== 'Issues' && <span> issues</span>}
      </div>
    </div>
  )
}
