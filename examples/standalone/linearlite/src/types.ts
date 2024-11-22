import { PriorityType, StatusType } from './types/issue'

export type Issue = {
  id: string
  title: string
  creator: string
  priority: PriorityType
  status: StatusType
  created: number
  modified: number
  kanbanorder: string
}
export type Comment = {
  id: string
  body: string
  creator: string
  issueId: string
  created: number
}
export type Description = {
  id: string
  body: string
}
