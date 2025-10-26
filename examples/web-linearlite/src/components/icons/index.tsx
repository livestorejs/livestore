import { BacklogIcon } from './backlog.tsx'
import { CanceledIcon } from './canceled.tsx'
import { DoneIcon } from './done.tsx'
import { FilterIcon } from './filter.tsx'
import { InProgressIcon } from './in-progress.tsx'
import { LinearLiteIcon } from './linear-lite.tsx'
import { LivestoreIcon } from './livestore.tsx'
import { NewIssueIcon } from './new-issue.tsx'
import { PriorityHighIcon } from './priority-high.tsx'
import { PriorityLowIcon } from './priority-low.tsx'
import { PriorityMediumIcon } from './priority-medium.tsx'
import { PriorityNoneIcon } from './priority-none.tsx'
import { PriorityUrgentIcon } from './priority-urgent.tsx'
import { SidebarIcon } from './sidebar.tsx'
import { TodoIcon } from './todo.tsx'

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
