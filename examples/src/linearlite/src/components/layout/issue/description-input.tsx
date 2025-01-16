import Editor from '@/components/common/editor'
import { mutations, tables } from '@/lib/livestore/schema'
import { Issue } from '@/types/issue'
import { useRow, useStore } from '@livestore/react'
import React from 'react'

export const DescriptionInput = ({ issue }: { issue: Issue }) => {
  const { store } = useStore()
  const [{ body: description }] = useRow(tables.description, issue.id)

  const handleDescriptionChange = (body: string) => store.mutate(mutations.updateDescription({ id: issue.id, body }))

  return (
    <Editor
      className="px-2 py-px rounded-md focus:bg-gray-50"
      value={description || ''}
      onChange={(value) => handleDescriptionChange(value)}
      placeholder="Add description..."
    />
  )
}
