import { IconName } from '@/components/icons'
import { Status } from '@/types/status'

export type StatusDetails = {
  name: string
  icon: IconName
  style: string
  shortcut: string
}

export const statusOptions = {
  backlog: {
    name: 'Backlog',
    icon: 'backlog',
    style: 'text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-200',
    shortcut: '1',
  },
  todo: {
    name: 'Todo',
    icon: 'todo',
    style: 'text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-200',
    shortcut: '2',
  },
  in_progress: {
    name: 'In Progress',
    icon: 'in-progress',
    style: 'text-yellow-500 group-hover:text-yellow-700 dark:text-yellow-400 dark:group-hover:text-yellow-300',
    shortcut: '3',
  },
  done: {
    name: 'Done',
    icon: 'done',
    style: 'text-indigo-500 group-hover:text-indigo-700 dark:text-indigo-400 dark:group-hover:text-indigo-300',
    shortcut: '4',
  },
  canceled: {
    name: 'Canceled',
    icon: 'canceled',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-300 dark:group-hover:text-neutral-200',
    shortcut: '5',
  },
} satisfies Record<Status, StatusDetails>
