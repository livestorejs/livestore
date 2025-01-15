import { IconName } from '@/components/icons'
import { Status } from '@/types/status'
import CancelIcon from '../assets/icons/cancel.svg?react'
import BacklogIcon from '../assets/icons/circle-dot.svg?react'
import TodoIcon from '../assets/icons/circle.svg?react'
import DoneIcon from '../assets/icons/done.svg?react'
import InProgressIcon from '../assets/icons/half-circle.svg?react'

export const StatusOptions = {
  backlog: { Icon: BacklogIcon, display: 'Backlog' },
  todo: { Icon: TodoIcon, display: 'To Do' },
  in_progress: { Icon: InProgressIcon, display: 'In Progress' },
  done: { Icon: DoneIcon, display: 'Done' },
  canceled: { Icon: CancelIcon, display: 'Canceled' },
} satisfies Record<Status, { Icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>; display: string }>

export const statusOptions = {
  backlog: { name: 'Backlog', icon: 'backlog', style: 'text-gray-400 group-hover:text-gray-600', shortcut: '1' },
  todo: { name: 'Todo', icon: 'todo', style: 'text-gray-400 group-hover:text-gray-600', shortcut: '2' },
  in_progress: {
    name: 'In Progress',
    icon: 'in-progress',
    style: 'text-yellow-500 group-hover:text-yellow-700',
    shortcut: '3',
  },
  done: { name: 'Done', icon: 'done', style: 'text-indigo-500 group-hover:text-indigo-700', shortcut: '4' },
  canceled: { name: 'Canceled', icon: 'canceled', style: 'text-gray-500 group-hover:text-gray-700', shortcut: '5' },
} satisfies Record<Status, { name: string; icon: IconName; style: string; shortcut: string }>
