import { Status } from '@/types/status'
import { PlusIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { Button } from 'react-aria-components'
import { Icon } from '../icons'

export const NewIssueButton = ({ status }: { status?: Status }) => {
  return (
    <Button
      aria-label="New Issue"
      className={`size-8 flex items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100 rounded-lg ${status ? '' : 'bg-white border border-gray-200 shadow'}`}
    >
      {status ? <PlusIcon className="size-4" /> : <Icon name="new-issue" className="size-4" />}
    </Button>
  )
}
