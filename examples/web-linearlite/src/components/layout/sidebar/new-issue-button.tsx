import { PlusIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { Button } from 'react-aria-components'
import { MenuContext, NewIssueModalContext } from '../../../app/contexts.ts'
import { Icon } from '../../icons/index.tsx'
import type { Status } from '../../../types/status.ts'

export const NewIssueButton = ({ status }: { status?: Status }) => {
  const { setNewIssueModalStatus } = React.useContext(NewIssueModalContext)!
  const { setShowMenu } = React.useContext(MenuContext)!

  return (
    <Button
      aria-label="New Issue"
      onPress={() => {
        setNewIssueModalStatus(status ?? 0)
        setShowMenu(false)
      }}
      className={`size-8 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 rounded-lg ${status === undefined ? 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow' : ''}`}
    >
      {status === undefined ? <Icon name="new-issue" className="size-4" /> : <PlusIcon className="size-4" />}
    </Button>
  )
}
