import type { Priority } from '@/types/priority'
import type { Status } from '@/types/status'

export type Issue = {
  id: number
  title: string
  creator: string
  priority: Priority
  status: Status
  created: Date
  modified: Date
  kanbanorder: string
}
