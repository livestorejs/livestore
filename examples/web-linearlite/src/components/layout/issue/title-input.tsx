import { type ChangeEvent, type FocusEvent, useCallback } from 'react'

import { events } from '../../../livestore/schema/index.ts'
import { useAppStore } from '../../../livestore/store.ts'
import type { Issue } from '../../../types/issue.ts'

export const TitleInput = ({
  issue,
  title,
  setTitle,
  className,
}: {
  issue?: Issue
  title?: string
  setTitle?: (title: string) => void
  className?: string
}) => {
  const store = useAppStore()

  const handleTitleChange = useCallback(
    (title: string) => {
      if (issue) store.commit(events.updateIssueTitle({ id: issue.id, title, modified: new Date() }))
      if (setTitle) setTitle(title)
    },
    [issue, setTitle, store],
  )

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => handleTitleChange(e.target.value),
    [handleTitleChange],
  )
  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => handleTitleChange(e.target.value),
    [handleTitleChange],
  )

  return (
    <input
      className={`input w-full text-xl bg-transparent max-w-xl font-semibold placeholder-neutral-400 border-none leading-none p-2 focus:outline-none focus:border-none focus:ring-0 focus:bg-neutral-50 dark:focus:bg-neutral-800 rounded-md ${className}`}
      placeholder="Issue title"
      value={issue?.title ?? title}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  )
}
