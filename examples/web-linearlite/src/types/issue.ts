import type { Priority } from './priority.ts'
import type { Status } from './status.ts'

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
