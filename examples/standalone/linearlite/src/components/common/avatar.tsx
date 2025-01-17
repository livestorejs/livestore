import { getAcronym } from '@/utils/get-acronym'
import React from 'react'

export const Avatar = ({ name }: { name?: string }) => {
  if (!name) name = 'Me'
  return (
    <div className="size-6 shrink-0 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-600 text-xs font-medium text-gray-500 dark:text-gray-300">
      {getAcronym(name)}
    </div>
  )
}
