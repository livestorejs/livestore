import { Schema } from '@livestore/livestore'

export const Filter = Schema.Literal('all', 'active', 'completed')
export type Filter = typeof Filter.Type

export const Status = Schema.Literal(0, 1, 2, 3, 4)
export type Status = typeof Status.Type

export const Priority = Schema.Literal(0, 1, 2, 3, 4)
export type Priority = typeof Priority.Type

export const ACTIVITY_TYPES = {
  CREATED: 'created',
  UPDATED: 'updated',
  ASSIGNED: 'assigned',
  STATUS_CHANGED: 'status_changed',
  PRIORITY_CHANGED: 'priority_changed',
  LINKED: 'linked',
} as const
