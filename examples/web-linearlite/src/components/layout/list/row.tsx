import { useStore } from '@livestore/react'
import type { CSSProperties } from 'react'
import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '@/components/common/avatar'
import { PriorityMenu } from '@/components/common/priority-menu'
import { StatusMenu } from '@/components/common/status-menu'
import { events } from '@/lib/livestore/schema'
import type { Issue } from '@/types/issue'
import type { Priority } from '@/types/priority'
import type { Status } from '@/types/status'
import { formatDate } from '@/utils/format-date'
import { getIssueTag } from '@/utils/get-issue-tag'

export const Row = memo(({ issue, style }: { issue: Issue; style: CSSProperties }) => {
  const navigate = useNavigate()
  const { store } = useStore()

  const handleChangeStatus = (status: Status) =>
    store.commit(events.updateIssueStatus({ id: issue.id, status, modified: new Date() }))

  const handleChangePriority = (priority: Priority) =>
    store.commit(events.updateIssuePriority({ id: issue.id, priority, modified: new Date() }))

  return (
    // biome-ignore lint/a11y/useSemanticElements: complex layout with multiple interactive elements
    <div
      key={issue.id}
      id={issue.id.toString()}
      role="button"
      tabIndex={0}
      className="flex items-center gap-4 justify-between pr-4 pl-2 lg:pl-4 w-full text-sm border-b last:border-b-0 border-neutral-200 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 dark:border-neutral-700"
      onClick={() => navigate(`issue/${issue.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`issue/${issue.id}`)
        }
      }}
      style={style}
    >
      <div className="flex items-center gap-px">
        <PriorityMenu priority={issue.priority} onPriorityChange={handleChangePriority} />
        <div className="text-neutral-500 dark:text-neutral-400 px-1 text-xs hidden lg:block min-w-14">
          {getIssueTag(issue.id)}
        </div>
        <StatusMenu status={issue.status} onStatusChange={handleChangeStatus} />
        <div className="font-medium ml-2 shrink line-clamp-1">{issue.title}</div>
      </div>
      <div className="flex items-center gap-4">
        <div className="hidden lg:block text-neutral-500 dark:text-neutral-400 text-xs">
          {formatDate(new Date(issue.created))}
        </div>
        <Avatar name={issue.creator} />
      </div>
    </div>
  )
})
