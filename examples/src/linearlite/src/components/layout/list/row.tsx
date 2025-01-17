import { Avatar } from '@/components/common/avatar'
import { PriorityMenu } from '@/components/common/priority-menu'
import { StatusMenu } from '@/components/common/status-menu'
import { mutations } from '@/lib/livestore/schema'
import { Issue } from '@/types/issue'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { formatDate } from '@/utils/format-date'
import { useStore } from '@livestore/react'
import type { CSSProperties } from 'react'
import React, { memo } from 'react'
import { useNavigate } from 'react-router-dom'

export const Row = memo(({ issue, style }: { issue: Issue; style: CSSProperties }) => {
  const navigate = useNavigate()
  const { store } = useStore()

  const handleChangeStatus = (status: Status) => store.mutate(mutations.updateIssueStatus({ id: issue.id, status }))

  const handleChangePriority = (priority: Priority) =>
    store.mutate(mutations.updateIssuePriority({ id: issue.id, priority }))

  return (
    <div
      key={issue.id}
      id={issue.id}
      className="flex items-center justify-between px-4 w-full text-sm border-b last:border-b-0 border-gray-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700"
      onClick={() => navigate(`/issue/${issue.id}`)}
      style={style}
    >
      <div className="flex items-center gap-px">
        <PriorityMenu priority={issue.priority} onPriorityChange={handleChangePriority} />
        <StatusMenu status={issue.status} onStatusChange={handleChangeStatus} />
        <div className="font-medium ml-2">{issue.title}</div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-gray-500 dark:text-gray-400 text-xs">{formatDate(new Date(issue.created))}</div>
        <Avatar name={issue.creator} />
      </div>
    </div>
  )
})
