import type React from 'react'

import CancelIcon from '../assets/icons/cancel.svg?react'
import BacklogIcon from '../assets/icons/circle-dot.svg?react'
import TodoIcon from '../assets/icons/circle.svg?react'
import DoneIcon from '../assets/icons/done.svg?react'
import InProgressIcon from '../assets/icons/half-circle.svg?react'

import HighPriorityIcon from '../assets/icons/signal-strong.svg?react'
import LowPriorityIcon from '../assets/icons/signal-weak.svg?react'
import MediumPriorityIcon from '../assets/icons/signal-medium.svg?react'
import NoPriorityIcon from '../assets/icons/dots.svg?react'
import UrgentPriorityIcon from '../assets/icons/rounded-claim.svg?react'
import { Schema } from 'effect'

export const PriorityType = Schema.Literal('none', 'urgent', 'high', 'low', 'medium').annotations({
  title: 'PriorityType',
})
export type PriorityType = typeof PriorityType.Type

export const PriorityOptions = {
  none: { Icon: NoPriorityIcon, display: 'None' },
  urgent: { Icon: UrgentPriorityIcon, display: 'Urgent' },
  high: { Icon: HighPriorityIcon, display: 'High' },
  low: { Icon: LowPriorityIcon, display: 'Low' },
  medium: { Icon: MediumPriorityIcon, display: 'Medium' },
} satisfies Record<PriorityType, { Icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>; display: string }>

export const StatusType = Schema.Literal('backlog', 'todo', 'in_progress', 'done', 'canceled').annotations({
  title: 'StatusType',
})
export type StatusType = typeof StatusType.Type

export const StatusOptions = {
  backlog: { Icon: BacklogIcon, display: 'Backlog' },
  todo: { Icon: TodoIcon, display: 'To Do' },
  in_progress: { Icon: InProgressIcon, display: 'In Progress' },
  done: { Icon: DoneIcon, display: 'Done' },
  canceled: { Icon: CancelIcon, display: 'Canceled' },
} satisfies Record<StatusType, { Icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>; display: string }>
