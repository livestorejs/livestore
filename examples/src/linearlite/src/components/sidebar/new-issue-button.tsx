import { NewIssueModalContext } from '@/app/provider'
import { Status } from '@/types/status'
import { PlusIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { Button } from 'react-aria-components'
import { Icon } from '../icons'

export const NewIssueButton = ({ status }: { status?: Status }) => {
  const { setShowNewIssueModal } = React.useContext(NewIssueModalContext)!

  return (
    <Button
      aria-label="New Issue"
      onPress={() => setShowNewIssueModal(true)}
      className={`size-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-800 rounded-lg ${status ? '' : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow'}`}
    >
      {status ? <PlusIcon className="size-4" /> : <Icon name="new-issue" className="size-4" />}
    </Button>
  )
}
