import { useStore } from '@livestore/react'
import React from 'react'

import { activeRun$, streamEvents$ } from '../livestore/queries.ts'
import type { StreamEvent, StreamRun } from '../livestore/schema.ts'

export const EventsList: React.FC = () => {
  const { store } = useStore()
  const activeRun = store.useQuery(activeRun$) as StreamRun | null
  const events = store.useQuery(streamEvents$) as ReadonlyArray<StreamEvent>

  const visibleEvents = React.useMemo(
    () => (activeRun ? events.filter((event) => event.datasetId === activeRun.datasetId) : []),
    [activeRun, events],
  )

  const lastSequence = visibleEvents.at(-1)?.sequence ?? 0
  const totalExpected = activeRun?.totalEvents ?? 0

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Streamed events</h2>
        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.9rem' }}>
          <span data-testid="event-count" data-count={visibleEvents.length}>
            Count: {visibleEvents.length}
          </span>
          <span data-testid="last-sequence" data-sequence={lastSequence}>
            Last seq: {lastSequence}
          </span>
          <span data-testid="expected-events" data-expected={totalExpected}>
            Expected: {totalExpected}
          </span>
        </div>
      </div>
      <ul style={{ maxHeight: '24rem', overflowY: 'auto', padding: 0, listStyle: 'none' }} data-testid="event-list">
        {visibleEvents.map((event) => (
          <li
            key={`${event.datasetId}-${event.sequence}`}
            data-sequence={event.sequence}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderBottom: '1px solid #ddd',
              padding: '0.5rem 0.25rem',
            }}
          >
            <span>{event.sequence}</span>
            <span>{event.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
