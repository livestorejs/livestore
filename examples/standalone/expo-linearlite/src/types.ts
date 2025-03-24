/* eslint-disable @typescript-eslint/no-redeclare */
import { Schema } from '@livestore/utils/effect'

export const Filter = Schema.Literal('all', 'active', 'completed')
export type Filter = typeof Filter.Type

export const STATUSES = {
  BACKLOG: 'backlog',
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  DONE: 'done',
  CANCELED: 'canceled',
  WONT_FIX: 'wont_fix',
  AUTO_CLOSED: 'auto_closed',
  TRIAGE: 'triage',
} as const

export const PRIORITIES = {
  NONE: 'none',
  URGENT: 'urgent',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const

export const ACTIVITY_TYPES = {
  CREATED: 'created',
  UPDATED: 'updated',
  ASSIGNED: 'assigned',
  STATUS_CHANGED: 'status_changed',
  PRIORITY_CHANGED: 'priority_changed',
  LINKED: 'linked',
} as const

export type Status = (typeof STATUSES)[keyof typeof STATUSES]
export type Priority = (typeof PRIORITIES)[keyof typeof PRIORITIES]
export type ActivityType = (typeof ACTIVITY_TYPES)[keyof typeof ACTIVITY_TYPES]
