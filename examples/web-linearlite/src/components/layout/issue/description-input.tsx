import Editor from '../../common/editor.tsx'

export const DescriptionInput = ({
  description,
  setDescription,
  className,
}: {
  description: string
  setDescription: (description: string) => void
  className?: string
}) => (
  <Editor
    className={`px-2 py-px rounded-md focus:bg-neutral-50 dark:focus:bg-neutral-800 ${className}`}
    value={description ?? ''}
    onChange={(value) => setDescription(value)}
    placeholder="Add description..."
  />
)
