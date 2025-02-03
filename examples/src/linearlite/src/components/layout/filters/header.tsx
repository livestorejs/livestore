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
    <div className="h-12 shrink-0 border-b border-neutral-200 dark:border-neutral-700 flex items-center gap-2 text-sm pl-2 lg:pl-6">
      <MenuButton className="lg:hidden" />
      <div className="font-medium ml-1 lg:ml-0">{heading}</div>
      <div className="text-neutral-500 dark:text-neutral-400">
        <span>{filteredCount}</span>
        {filteredCount !== totalCount && <span> of {totalCount}</span>}
        {heading !== 'Issues' && <span> issues</span>}
      </div>
    </div>
  )
}
