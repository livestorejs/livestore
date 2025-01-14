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
