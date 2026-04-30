import { useCallback } from 'react'

import Editor from '../../common/editor.tsx'

export const DescriptionInput = ({
  description,
  setDescription,
  className,
}: {
  description: string
  setDescription: (description: string) => void
  className?: string
}) => {
  const handleChange = useCallback((value: string) => setDescription(value), [setDescription])

  return (
    <Editor
      className={`px-2 py-px rounded-md focus:bg-neutral-50 dark:focus:bg-neutral-800 ${className}`}
      value={description ?? ''}
      onChange={handleChange}
      placeholder="Add description..."
    />
  )
}
