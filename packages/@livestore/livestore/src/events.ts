// Todo: typesafe events
export type LiveStoreEvent = {
  type: string
  id: string
  args?: any
}

export const EVENTS_TABLE_NAME = '__livestore_events'
