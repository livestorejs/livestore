import { BacklogIcon } from '@/components/icons/backlog'
import { CanceledIcon } from '@/components/icons/canceled'
import { DoneIcon } from '@/components/icons/done'
import { FilterIcon } from '@/components/icons/filter'
import { InProgressIcon } from '@/components/icons/in-progress'
import { LinearLiteIcon } from '@/components/icons/linear-lite'
import { LivestoreIcon } from '@/components/icons/livestore'
import { NewIssueIcon } from '@/components/icons/new-issue'
import { PriorityHighIcon } from '@/components/icons/priority-high'
import { PriorityLowIcon } from '@/components/icons/priority-low'
import { PriorityMediumIcon } from '@/components/icons/priority-medium'
import { PriorityNoneIcon } from '@/components/icons/priority-none'
import { PriorityUrgentIcon } from '@/components/icons/priority-urgent'
import { SidebarIcon } from '@/components/icons/sidebar'
import { TodoIcon } from '@/components/icons/todo'
import React from 'react'

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
