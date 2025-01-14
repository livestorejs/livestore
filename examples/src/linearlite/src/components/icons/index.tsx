import React from 'react'
import { BacklogIcon } from './backlog'
import { CanceledIcon } from './canceled'
import { DoneIcon } from './done'
import { InProgressIcon } from './in-progress'
import { LinearLiteIcon } from './linear-lite'
import { LivestoreIcon } from './livestore'
import { NewIssueIcon } from './new-issue'
import { SidebarIcon } from './sidebar'
import { TodoIcon } from './todo'

const icons = {
  backlog: BacklogIcon,
  canceled: CanceledIcon,
  done: DoneIcon,
  'in-progress': InProgressIcon,
  linearlite: LinearLiteIcon,
  livestore: LivestoreIcon,
  'new-issue': NewIssueIcon,
  sidebar: SidebarIcon,
  todo: TodoIcon,
}

type IconName = keyof typeof icons

export const Icon = ({ name, className }: { name: IconName; className?: string }) => {
  const Component = icons[name]
  return <Component className={className} />
}
