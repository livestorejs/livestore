import Editor from '@/components/common/editor'
import { mutations, tables } from '@/lib/livestore/schema'
import { Issue } from '@/types/issue'
import { useRow, useStore } from '@livestore/react'
import React from 'react'

export const DescriptionInput = ({
  issue,
  description,
  setDescription,
  className,
}: {
  issue?: Issue
  description?: string
  setDescription?: (description: string) => void
  className?: string
}) => {
  const { store } = useStore()
  if (issue) {
    const [{ body }] = useRow(tables.description, issue.id)
    description = body
  }

  const handleDescriptionChange = (body: string) => {
    if (issue) store.mutate(mutations.updateDescription({ id: issue.id, body }))
    if (setDescription) setDescription(body)
  }

  return (
    <Editor
      className={`px-2 py-px rounded-md focus:bg-gray-50 ${className}`}
      value={description ?? ''}
      onChange={(value) => handleDescriptionChange(value)}
      placeholder="Add description..."
    />
  )
}
