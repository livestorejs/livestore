import React from 'react'
import { BacklogIcon } from './backlog'
import { CanceledIcon } from './canceled'
import { DoneIcon } from './done'
import { FilterIcon } from './filter'
import { InProgressIcon } from './in-progress'
import { LinearLiteIcon } from './linear-lite'
import { LivestoreIcon } from './livestore'
import { NewIssueIcon } from './new-issue'
import { PriorityHighIcon } from './priority-high'
import { PriorityLowIcon } from './priority-low'
import { PriorityMediumIcon } from './priority-medium'
import { PriorityNoneIcon } from './priority-none'
import { PriorityUrgentIcon } from './priority-urgent'
import { SidebarIcon } from './sidebar'
import { TodoIcon } from './todo'

const icons = {
  backlog: BacklogIcon,
  canceled: CanceledIcon,
  done: DoneIcon,
  filter: FilterIcon,
  'in-progress': InProgressIcon,
  linearlite: LinearLiteIcon,
  livestore: LivestoreIcon,
  'new-issue': NewIssueIcon,
  'priority-none': PriorityNoneIcon,
  'priority-low': PriorityLowIcon,
  'priority-medium': PriorityMediumIcon,
  'priority-high': PriorityHighIcon,
  'priority-urgent': PriorityUrgentIcon,
  sidebar: SidebarIcon,
  todo: TodoIcon,
}

export type IconName = keyof typeof icons

export const Icon = ({ name, className }: { name: IconName; className?: string }) => {
  const Component = icons[name]
  return <Component className={className} />
}
