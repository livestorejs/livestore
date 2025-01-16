import { mutations } from '@/lib/livestore/schema'
import { Issue } from '@/types/issue'
import { useStore } from '@livestore/react'
import React from 'react'

export const TitleInput = ({ issue, className }: { issue: Issue; className?: string }) => {
  const { store } = useStore()

  const handleTitleChange = (title: string, { inProgress }: { inProgress: boolean }) =>
    store.mutate({ persisted: inProgress === false }, mutations.updateIssueTitle({ id: issue.id, title }))

  return (
    <input
      className={`w-full text-xl max-w-xl font-semibold placeholder-gray-400 border-none leading-none p-2 focus:outline-none focus:border-none focus:ring-0 focus:bg-gray-50 rounded-md ${className}`}
      placeholder="Issue title"
      value={issue.title}
      onChange={(e) => handleTitleChange(e.target.value, { inProgress: true })}
      onBlur={(e) => handleTitleChange(e.target.value, { inProgress: false })}
    />
  )
}
