import { IconName } from '@/components/icons'
import { Priority } from '@/types/priority'
import type React from 'react'
import NoPriorityIcon from '../assets/icons/dots.svg?react'
import UrgentPriorityIcon from '../assets/icons/rounded-claim.svg?react'
import MediumPriorityIcon from '../assets/icons/signal-medium.svg?react'
import HighPriorityIcon from '../assets/icons/signal-strong.svg?react'
import LowPriorityIcon from '../assets/icons/signal-weak.svg?react'

export const PriorityOptions = {
  none: { Icon: NoPriorityIcon, display: 'None' },
  urgent: { Icon: UrgentPriorityIcon, display: 'Urgent' },
  high: { Icon: HighPriorityIcon, display: 'High' },
  low: { Icon: LowPriorityIcon, display: 'Low' },
  medium: { Icon: MediumPriorityIcon, display: 'Medium' },
} satisfies Record<Priority, { Icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>; display: string }>

export const priorityOptions = {
  none: { name: 'None', icon: 'priority-none', style: 'text-gray-500 group-hover:text-gray-700', shortcut: '0' },
  low: { name: 'Low', icon: 'priority-low', style: 'text-gray-500 group-hover:text-gray-700', shortcut: '1' },
  medium: { name: 'Medium', icon: 'priority-medium', style: 'text-gray-500 group-hover:text-gray-700', shortcut: '2' },
  high: { name: 'High', icon: 'priority-high', style: 'text-gray-500 group-hover:text-gray-700', shortcut: '3' },
  urgent: { name: 'Urgent', icon: 'priority-urgent', style: 'text-gray-500 group-hover:text-gray-700', shortcut: '4' },
} satisfies Record<Priority, { name: string; icon: IconName; style: string; shortcut: string }>
