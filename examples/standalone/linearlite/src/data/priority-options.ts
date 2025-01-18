import { IconName } from '@/components/icons'
import { Priority } from '@/types/priority'

export const priorityOptions = {
  none: {
    name: 'None',
    icon: 'priority-none',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '0',
  },
  low: {
    name: 'Low',
    icon: 'priority-low',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '1',
  },
  medium: {
    name: 'Medium',
    icon: 'priority-medium',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '2',
  },
  high: {
    name: 'High',
    icon: 'priority-high',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '3',
  },
  urgent: {
    name: 'Urgent',
    icon: 'priority-urgent',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '4',
  },
} satisfies Record<Priority, { name: string; icon: IconName; style: string; shortcut: string }>
