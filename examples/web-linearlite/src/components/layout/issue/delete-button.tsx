import { TrashIcon } from '@heroicons/react/16/solid'
import { useStore } from '@livestore/react'
import React from 'react'
import { Button } from 'react-aria-components'
import { events } from '../../../livestore/schema/index.ts'

export const DeleteButton = ({
  issueId,
  close,
  className,
}: {
  issueId: number
  close: () => void
  className?: string
}) => {
  const { store } = useStore()
  const [confirm, setConfirm] = React.useState(false)

  const onClick = () => {
    if (confirm) {
      const deleted = new Date()
      store.commit(
        events.deleteIssue({ id: issueId, deleted }),
        events.deleteDescription({ id: issueId, deleted }),
        events.deleteCommentsByIssueId({ issueId, deleted }),
      )
      setConfirm(false)
      close()
    }
    setConfirm(true)
    setTimeout(() => {
      setConfirm(false)
    }, 2000)
  }

  return (
    <Button
      aria-label="Delete issue"
      onPress={onClick}
      className={`rounded-lg h-8 min-w-8 px-2 flex items-center justify-center hover:bg-neutral-100 hover:text-red-600 dark:hover:text-red-500 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 focus:text-red-600 dark:focus:bg-neutral-800 dark:focus:text-red-500 ${className}`}
    >
      <TrashIcon className="size-3.5" />
      {confirm && (
        <span className="ml-1.5 mr-1 font-medium">
          Confirm<span className="hidden lg:inline"> delete</span>
        </span>
      )}
    </Button>
  )
}
