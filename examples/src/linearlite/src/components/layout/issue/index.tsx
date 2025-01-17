import { Avatar } from '@/components/common/avatar'
import { MenuButton } from '@/components/common/menu-button'
import { PriorityMenu } from '@/components/common/priority-menu'
import { StatusMenu } from '@/components/common/status-menu'
import { mutations, tables } from '@/lib/livestore/schema'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { formatDate } from '@/utils/format-date'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { useRow, useStore } from '@livestore/react'
import React from 'react'
import { Button } from 'react-aria-components'
import { useNavigate, useParams } from 'react-router-dom'
import { BackButton } from './back-button'
import { CommentInput } from './comment-input'
import { Comments } from './comments'
import { DeleteButton } from './delete-button'
import { DescriptionInput } from './description-input'
import { TitleInput } from './title-input'

export const Issue = () => {
  const id = useParams().id ?? ''
  const navigate = useNavigate()
  const { store } = useStore()
  const [issue] = useRow(tables.issue, id)

  const close = () => {
    if (window.history.length > 2) navigate(-1)
    else navigate('/')
  }

  const handleChangeStatus = (status: Status) => {
    store.mutate(mutations.updateIssueStatus({ id: issue.id, status }))
  }

  const handleChangePriority = (priority: Priority) => {
    store.mutate(mutations.updateIssuePriority({ id: issue.id, priority }))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-8 px-2 lg:pl-6">
        <div className="flex items-center gap-1 lg:gap-2 text-sm">
          <MenuButton />
          <Button
            aria-label="Back to issues"
            className="font-medium hover:text-gray-800 dark:hover:text-gray-100 focus:outline-none ml-2 lg:ml-0"
            onPress={close}
          >
            Issues
          </Button>
          <ChevronRightIcon className="size-3.5" />
          <div className="text-gray-500 dark:text-gray-400">{id}</div>
        </div>
        <div className="flex items-center gap-px">
          <DeleteButton issueId={id} close={close} className="hidden lg:block" />
          <BackButton close={close} />
        </div>
      </div>
      <div className="flex flex-col lg:flex-row h-[calc(100%-3rem)]">
        <div className="flex lg:hidden flex-wrap justify-between gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-px">
            <StatusMenu showLabel status={issue.status} onStatusChange={handleChangeStatus} />
            <PriorityMenu showLabel priority={issue.priority} onPriorityChange={handleChangePriority} />
          </div>
          <div className="flex items-center gap-2">
            <div className="text-gray-500 dark:text-gray-400 text-xs">{formatDate(new Date(issue.created))}</div>
            <Avatar name={issue.creator} />
          </div>
        </div>
        <div className="grow overflow-y-auto">
          <div className="p-4 lg:p-14 border-b border-gray-200 dark:border-gray-700">
            <TitleInput issue={issue} className="lg:mb-4" />
            <DescriptionInput issue={issue} />
          </div>
          <div className="p-4 lg:p-14">
            <h2 className="leading-none text-2xs uppercase font-medium tracking-wide text-gray-400 mb-4">Comments</h2>
            <CommentInput issueId={issue.id} />
            <Comments issueId={issue.id} />
          </div>
        </div>
        <div className="hidden lg:block w-64 py-16 px-8 border-l border-gray-200 dark:border-gray-700 space-y-px">
          <h2 className="leading-none text-2xs uppercase font-medium tracking-wide text-gray-400 mb-4">Properties</h2>
          <div className="flex items-center h-8">
            <div className="w-16 -mr-0.5 shrink-0">Creator:</div>
            <Avatar name={issue.creator} />
            <div className="font-medium ml-2.5 mr-2">{issue.creator}</div>
          </div>
          <div className="flex items-center h-8">
            <div className="w-16 shrink-0">Created:</div>
            <div>{formatDate(new Date(issue.created))}</div>
          </div>
          <div className="flex items-center h-8">
            <div className="w-14 shrink-0">Status:</div>
            <StatusMenu showLabel status={issue.status} onStatusChange={handleChangeStatus} />
          </div>
          <div className="flex items-center h-8">
            <div className="w-14 shrink-0">Priority:</div>
            <PriorityMenu showLabel priority={issue.priority} onPriorityChange={handleChangePriority} />
          </div>
        </div>
      </div>
    </div>
  )
}
