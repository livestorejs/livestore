import { Priority } from '@/types/priority'
import { Status } from '@/types/status'

export type Issue = {
  id: number
  title: string
  creator: string
  priority: Priority
  status: Status
  created: number
  modified: number
  kanbanorder: string
}
