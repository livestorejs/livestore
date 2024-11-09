import React from 'react'
import { memo, type CSSProperties } from 'react'
import classNames from 'classnames'
import { useNavigate } from 'react-router-dom'
import { DraggableProvided } from 'react-beautiful-dnd'
import Avatar from '../../components/Avatar'
import PriorityMenu from '../../components/contextmenu/PriorityMenu'
import PriorityIcon from '../../components/PriorityIcon'
import { Issue } from '../../types'
import { PriorityType } from '../../types/issue'
import { useStore } from '@livestore/react'
import { mutations } from '../../domain/schema'

interface IssueProps {
  issue: Issue
  index: number
  isDragging?: boolean
  provided: DraggableProvided
  style?: CSSProperties
}

export const itemHeight = 100

function getStyle(provided: DraggableProvided, style?: CSSProperties): CSSProperties {
  return {
    ...provided.draggableProps.style,
    ...(style || {}),
    height: `${itemHeight}px`,
  }
}

// eslint-disable-next-line react-refresh/only-export-components
const IssueItem = ({ issue, style, isDragging, provided }: IssueProps) => {
  const { store } = useStore()
  const navigate = useNavigate()
  const priorityIcon = (
    <span className="inline-block m-0.5 rounded-sm border border-gray-100 hover:border-gray-200 p-0.5">
      <PriorityIcon priority={issue.priority} />
    </span>
  )

  const updatePriority = (priority: PriorityType) =>
    store.mutate(mutations.updateIssuePriority({ id: issue.id, priority }))

  return (
    <div
      ref={provided.innerRef}
      className={classNames('cursor-default flex flex-col w-full px-4 py-3 mb-2 bg-white rounded focus:outline-none', {
        'shadow-modal': isDragging,
      })}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      style={getStyle(provided, style)}
      onClick={() => navigate(`/issue/${issue.id}`)}
    >
      <div className="flex justify-between w-full cursor-default">
        <div className="flex flex-col">
          <span className="mt-1 text-sm font-medium text-gray-700 line-clamp-2 overflow-ellipsis">{issue.title}</span>
        </div>
        <div className="flex-shrink-0">
          <Avatar name={issue.creator} />
        </div>
      </div>
      <div className="mt-2.5 flex items-center">
        <PriorityMenu
          button={priorityIcon}
          id={'priority-menu-' + issue.id}
          filterKeyword={true}
          onSelect={(p) => updatePriority(p)}
        />
      </div>
    </div>
  )
}

const memoed = memo(IssueItem)
export default memoed
