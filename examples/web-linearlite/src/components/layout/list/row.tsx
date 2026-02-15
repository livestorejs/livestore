import { useNavigate, useParams } from '@tanstack/react-router'
import type { CSSProperties, KeyboardEvent } from 'react'
import { memo, useCallback, useMemo } from 'react'

import { events } from '../../../livestore/schema/index.ts'
import { useAppStore } from '../../../livestore/store.ts'
import type { Issue } from '../../../types/issue.ts'
import type { Priority } from '../../../types/priority.ts'
import type { Status } from '../../../types/status.ts'
import { formatDate } from '../../../utils/format-date.ts'
import { getIssueTag } from '../../../utils/get-issue-tag.ts'
import { Avatar } from '../../common/avatar.tsx'
import { PriorityMenu } from '../../common/priority-menu.tsx'
import { StatusMenu } from '../../common/status-menu.tsx'

export const Row = memo(({ issue, style }: { issue: Issue; style: CSSProperties }) => {
  const navigate = useNavigate()
  const store = useAppStore()
  const { storeId } = useParams({ from: '/$storeId' })
  const params = useMemo(() => ({ storeId }), [storeId])
  const search = useCallback((prev: Record<string, unknown>) => ({ ...prev, issueId: issue.id.toString() }), [issue.id])

  const handleChangeStatus = useCallback(
    (status: Status) => store.commit(events.updateIssueStatus({ id: issue.id, status, modified: new Date() })),
    [issue.id, store],
  )

  const handleChangePriority = useCallback(
    (priority: Priority) => store.commit(events.updateIssuePriority({ id: issue.id, priority, modified: new Date() })),
    [issue.id, store],
  )

  const openIssue = useCallback(() => {
    navigate({
      to: '/$storeId/issue',
      params,
      search,
    })
  }, [navigate, params, search])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openIssue()
      }
    },
    [openIssue],
  )

  return (
    // biome-ignore lint/a11y/useSemanticElements: complex layout with multiple interactive elements
    <div
      key={issue.id}
      id={issue.id.toString()}
      role="button"
      tabIndex={0}
      className="flex items-center gap-4 justify-between pr-4 pl-2 lg:pl-4 w-full text-sm border-b last:border-b-0 border-neutral-200 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 dark:border-neutral-700"
      onClick={openIssue}
      onKeyDown={handleKeyDown}
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
