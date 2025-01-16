import { Avatar } from '@/components/common/avatar'
import { PriorityMenu } from '@/components/common/priority-menu'
import { StatusMenu } from '@/components/common/status-menu'
import { mutations } from '@/lib/livestore/schema'
import { Issue } from '@/types/issue'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { useStore } from '@livestore/react'
import type { CSSProperties } from 'react'
import React, { memo } from 'react'
import { useNavigate } from 'react-router-dom'

export const Card = memo(({ issue, style }: { issue: Issue; style: CSSProperties }) => {
  const navigate = useNavigate()
  const { store } = useStore()

  const handleChangeStatus = (status: Status) => store.mutate(mutations.updateIssueStatus({ id: issue.id, status }))

  const handleChangePriority = (priority: Priority) =>
    store.mutate(mutations.updateIssuePriority({ id: issue.id, priority }))

  return (
    <div key={issue.id} id={issue.id} className="px-2 pb-2" style={style}>
      <div
        className="p-2 w-full text-sm bg-white rounded-md shadow-sm cursor-pointer h-full"
        onClick={() => navigate(`/issue/${issue.id}`)}
      >
        <div className="flex items-center gap-px">
          {/* <PriorityMenu priority={issue.priority} onPriorityChange={handleChangePriority} /> */}
          <StatusMenu status={issue.status} onStatusChange={handleChangeStatus} />
          <div className="font-medium grow line-clamp-1">{issue.title}</div>
        </div>
        <div className="flex items-center justify-between pr-2 mt-1">
          <PriorityMenu showLabel priority={issue.priority} onPriorityChange={handleChangePriority} />
          <Avatar name={issue.creator} />
        </div>
      </div>
    </div>
  )
})
