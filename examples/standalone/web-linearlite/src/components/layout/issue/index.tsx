import { Avatar } from '@/components/common/avatar'
import { MenuButton } from '@/components/common/menu-button'
import { PriorityMenu } from '@/components/common/priority-menu'
import { StatusMenu } from '@/components/common/status-menu'
import { BackButton } from '@/components/layout/issue/back-button'
import { CommentInput } from '@/components/layout/issue/comment-input'
import { Comments } from '@/components/layout/issue/comments'
import { DeleteButton } from '@/components/layout/issue/delete-button'
import { DescriptionInput } from '@/components/layout/issue/description-input'
import { TitleInput } from '@/components/layout/issue/title-input'
import { events, tables } from '@/lib/livestore/schema'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { formatDate } from '@/utils/format-date'
import { getIssueTag } from '@/utils/get-issue-tag'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { useStore } from '@livestore/react'
import { queryDb } from '@livestore/livestore'
import React from 'react'
import { Button } from 'react-aria-components'
import { useNavigate, useParams } from 'react-router-dom'

export const Issue = () => {
  const id = Number(useParams().id ?? 0)
  const navigate = useNavigate()
  const { store } = useStore()
  const issue = store.useQuery(queryDb(tables.issue.where({ id }).first(), { deps: [id] }))

  const close = () => {
    if (window.history.length > 2) navigate(-1)
    else navigate('/')
  }

  const handleChangeStatus = (status: Status) => {
    store.commit(events.updateIssueStatus({ id: issue.id, status, modified: new Date() }))
  }

  const handleChangePriority = (priority: Priority) => {
    store.commit(events.updateIssuePriority({ id: issue.id, priority, modified: new Date() }))
  }

  const handleChangeDescription = (body: string) => {
    store.commit(events.updateDescription({ id: issue.id, body }))
  }

  const description = store.useQuery(
    queryDb(tables.description.select('body').where({ id: issue.id }).first(), { deps: [issue.id] }),
  )

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between gap-8 px-2 lg:pl-6">
        <div className="flex items-center gap-1 lg:gap-2 text-sm">
          <MenuButton className="lg:hidden" />
          <Button
            aria-label="Back to issues"
            className="font-medium hover:text-neutral-800 dark:hover:text-neutral-100 focus:outline-none ml-2 lg:ml-0"
            onPress={close}
          >
            Issues
          </Button>
          <ChevronRightIcon className="size-3.5" />
          <div className="text-neutral-500 dark:text-neutral-400">{getIssueTag(id)}</div>
        </div>
        <div className="flex items-center gap-px">
          <DeleteButton issueId={id} close={close} className="hidden lg:block" />
          <BackButton close={close} />
        </div>
      </div>
      <div className="flex flex-col lg:flex-row h-[calc(100%-3rem)]">
        <div className="flex lg:hidden flex-wrap justify-between gap-2 p-4 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center gap-px">
            <StatusMenu showLabel status={issue.status} onStatusChange={handleChangeStatus} />
            <PriorityMenu showLabel priority={issue.priority} onPriorityChange={handleChangePriority} />
          </div>
          <div className="flex items-center gap-2">
            <div className="text-neutral-500 dark:text-neutral-400 text-xs">{formatDate(new Date(issue.created))}</div>
            <Avatar name={issue.creator} />
          </div>
        </div>
        <div className="grow overflow-y-auto">
          <div className="p-4 lg:p-14 border-b border-neutral-200 dark:border-neutral-700">
            <TitleInput issue={issue} className="lg:mb-4" />
            <DescriptionInput description={description} setDescription={handleChangeDescription} />
          </div>
          <div className="p-4 lg:p-14">
            <h2 className="leading-none text-2xs uppercase font-medium tracking-wide text-neutral-400 mb-4">
              Comments
            </h2>
            <CommentInput issueId={issue.id} />
            <Comments issueId={issue.id} />
          </div>
        </div>
        <div className="hidden lg:block w-64 py-16 px-8 border-l border-neutral-200 dark:border-neutral-700 space-y-px">
          <h2 className="leading-none text-2xs uppercase font-medium tracking-wide text-neutral-400 mb-4">
            Properties
          </h2>
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
