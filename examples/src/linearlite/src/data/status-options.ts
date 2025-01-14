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
