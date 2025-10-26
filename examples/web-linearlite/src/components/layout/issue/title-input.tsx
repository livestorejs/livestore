import { useStore } from '@livestore/react'
import { events } from '../../../livestore/schema/index.ts'
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
  const { store } = useStore()

  const handleTitleChange = (title: string) => {
    if (issue) store.commit(events.updateIssueTitle({ id: issue.id, title, modified: new Date() }))
    if (setTitle) setTitle(title)
  }

  return (
    <input
      className={`input w-full text-xl bg-transparent max-w-xl font-semibold placeholder-neutral-400 border-none leading-none p-2 focus:outline-none focus:border-none focus:ring-0 focus:bg-neutral-50 dark:focus:bg-neutral-800 rounded-md ${className}`}
      placeholder="Issue title"
      value={issue?.title ?? title}
      onChange={(e) => handleTitleChange(e.target.value)}
      onBlur={(e) => handleTitleChange(e.target.value)}
    />
  )
}
