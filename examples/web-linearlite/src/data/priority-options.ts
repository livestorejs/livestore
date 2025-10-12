import type { IconName } from '../components/icons/index.tsx'

export const priorityOptions: { name: string; icon: IconName; style: string; shortcut: string }[] = [
  {
    name: 'None',
    icon: 'priority-none',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '0',
  },
  {
    name: 'Low',
    icon: 'priority-low',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '1',
  },
  {
    name: 'Medium',
    icon: 'priority-medium',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '2',
  },
  {
    name: 'High',
    icon: 'priority-high',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '3',
  },
  {
    name: 'Urgent',
    icon: 'priority-urgent',
    style: 'text-neutral-500 group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-300',
    shortcut: '4',
  },
]
