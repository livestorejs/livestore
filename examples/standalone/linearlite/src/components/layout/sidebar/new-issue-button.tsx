import { MenuContext, NewIssueModalContext } from '@/app/contexts'
import { Icon } from '@/components/icons'
import { Status } from '@/types/status'
import { PlusIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { Button } from 'react-aria-components'

export const NewIssueButton = ({ status }: { status?: Status }) => {
  const { setShowNewIssueModal } = React.useContext(NewIssueModalContext)!
  const { setShowMenu } = React.useContext(MenuContext)!

  return (
    <Button
      aria-label="New Issue"
      onPress={() => {
        setShowNewIssueModal(true)
        setShowMenu(false)
      }}
      className={`size-8 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 rounded-lg ${status ? '' : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow'}`}
    >
      {status ? <PlusIcon className="size-4" /> : <Icon name="new-issue" className="size-4" />}
    </Button>
  )
}
