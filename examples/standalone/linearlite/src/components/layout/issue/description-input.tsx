import Editor from '@/components/common/editor'
import { Issue, mutations, tables } from '@/lib/livestore/schema'
import { useQuery, useStore } from '@livestore/react'
import { queryDb } from '@livestore/livestore'
import React from 'react'

export const DescriptionInput = ({
  issue,
  description,
  setDescription,
  updateOnBlur,
  className,
}: {
  issue?: Issue
  description?: string
  setDescription?: (description: string) => void
  updateOnBlur?: boolean
  className?: string
}) => {
  const { store } = useStore()
  description = useQuery(
    queryDb(
      tables.description.query
        .select('body', { pluck: true })
        .where({ id: issue?.id ?? 0 })
        .first(),
      { deps: [issue?.id] },
    ),
  )

  const handleDescriptionChange = (body: string) => {
    if (issue) store.commit(mutations.updateDescription({ id: issue.id, body }))
    if (setDescription) setDescription(body)
  }

  return (
    <Editor
      className={`px-2 py-px rounded-md focus:bg-neutral-50 dark:focus:bg-neutral-800 ${className}`}
      value={description ?? ''}
      onBlur={updateOnBlur ? (value) => handleDescriptionChange(value) : undefined}
      onChange={updateOnBlur ? undefined : (value) => handleDescriptionChange(value)}
      placeholder="Add description..."
    />
  )
}
