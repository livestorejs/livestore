import { mutations } from '@/lib/livestore/schema'
import { Issue } from '@/types/issue'
import { useStore } from '@livestore/react'
import React from 'react'

export const TitleInput = ({
  issue,
  title,
  setTitle,
  className,
  autoFocus,
}: {
  issue?: Issue
  title?: string
  setTitle?: (title: string) => void
  className?: string
  autoFocus?: boolean
}) => {
  const { store } = useStore()

  const handleTitleChange = (title: string) => {
    if (issue) store.mutate(mutations.updateIssueTitle({ id: issue.id, title }))
    if (setTitle) setTitle(title)
  }

  return (
    <input
      autoFocus={autoFocus}
      className={`input w-full text-xl bg-transparent max-w-xl font-semibold placeholder-neutral-400 border-none leading-none p-2 focus:outline-none focus:border-none focus:ring-0 focus:bg-neutral-50 dark:focus:bg-neutral-800 rounded-md ${className}`}
      placeholder="Issue title"
      value={issue?.title ?? title}
      onChange={(e) => handleTitleChange(e.target.value)}
      onBlur={(e) => handleTitleChange(e.target.value)}
    />
  )
}
