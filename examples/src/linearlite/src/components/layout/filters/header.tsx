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
    <div className="h-12 border-b border-gray-200 flex items-center gap-2 text-sm pl-6">
      <div className="font-medium">{heading}</div>
      <div className="text-gray-500">
        <span>{filteredCount}</span>
        {filteredCount !== totalCount && <span> of {totalCount}</span>}
        {heading !== 'Issues' && <span> issues</span>}
      </div>
    </div>
  )
}
