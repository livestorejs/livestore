import { IconName } from '@/components/icons'

export type StatusDetails = {
  name: string
  icon: IconName
  style: string
  shortcut: string
}

export const statusOptions: StatusDetails[] = [
  {
    name: 'Backlog',
    icon: 'backlog',
    style: 'text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-200',
    shortcut: '1',
  },
  {
    name: 'Todo',
    icon: 'todo',
    style: 'text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-200',
    shortcut: '2',
  },
  {
    name: 'In Progress',
    icon: 'in-progress',
    style: 'text-yellow-500 group-hover:text-yellow-700 dark:text-yellow-400 dark:group-hover:text-yellow-300',
    shortcut: '3',
  },
  {
    name: 'Done',
    icon: 'done',
    style: 'text-indigo-500 group-hover:text-indigo-700 dark:text-indigo-400 dark:group-hover:text-indigo-300',
    shortcut: '4',
  },
  {
    name: 'Canceled',
    icon: 'canceled',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-300 dark:group-hover:text-neutral-200',
    shortcut: '5',
  },
]
