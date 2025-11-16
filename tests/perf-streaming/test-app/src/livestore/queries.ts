import { queryDb } from '@livestore/livestore'
import type { StreamEvent, StreamRun } from './schema.ts'
import { tables } from './schema.ts'

export const activeRun$ = queryDb<StreamRun | null>(
  tables.streamRuns
    .select()
    .orderBy([{ col: 'startedAt', direction: 'desc' }])
    .first({ behaviour: 'fallback', fallback: () => null }),
  { label: 'activeRun' },
)

export const streamEvents$ = queryDb<ReadonlyArray<StreamEvent>>(
  tables.streamEvents.select().orderBy([{ col: 'sequence', direction: 'asc' }]),
  { label: 'streamEvents' },
)
