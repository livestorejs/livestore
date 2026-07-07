import React from 'react'

import { EventSequenceNumber } from '@livestore/common/schema'

import { useAppStore } from '../livestore/store.ts'

const MAX_EVENT_ITEMS = 500

const sectionStyle = { marginTop: '1.5rem' } as const
const headingStyle = { margin: '0 0 0.75rem 0' } as const
const listStyle = { maxHeight: '26rem', overflowY: 'auto', padding: 0, listStyle: 'none', margin: 0 } as const
const listItemStyle = {
  borderBottom: '1px solid #ddd',
  padding: '0.5rem 0.25rem',
  fontFamily: 'monospace',
  fontSize: '0.85rem',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const
const emptyStateStyle = { color: '#555' } as const

type DisplayEvent = {
  id: string
  json: string
}

type EventsListProps = {
  batchSize: number
  /** When set, the stream stops after reaching this global sequence number */
  until: number | undefined
}

type DisplaySeqNum = {
  global: number
  client: number
  rebaseGeneration: number
}

const sanitizeBatchSize = (value: number) => Math.max(1, Math.floor(value) || 1)

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    return typeof value === 'string' ? value : String(error)
  }
}

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> => typeof value === 'object' && value !== null

const getDisplaySeqNum = (value: unknown): DisplaySeqNum | undefined => {
  if (isRecord(value) === false || isRecord(value.seqNum) === false) {
    return undefined
  }

  const { global, client, rebaseGeneration } = value.seqNum
  if (typeof global !== 'number' || typeof client !== 'number' || typeof rebaseGeneration !== 'number') {
    return undefined
  }

  return { global, client, rebaseGeneration }
}

export const EventsList: React.FC<EventsListProps> = ({ batchSize, until }) => {
  const store = useAppStore()
  const [events, setEvents] = React.useState<ReadonlyArray<DisplayEvent>>([])
  const [streamedCount, setStreamedCount] = React.useState(0)
  const lastSeqRef = React.useRef(0)
  const preferredBatchSize = sanitizeBatchSize(batchSize)

  React.useEffect(() => {
    let cancelled = false
    lastSeqRef.current = 0
    const eventStream = store.events({
      batchSize: preferredBatchSize,
      ...(until !== undefined && { until: EventSequenceNumber.Client.fromString(`e${until}`) }),
    })

    const run = async () => {
      try {
        for await (const value of eventStream) {
          if (cancelled === true) break

          const seqNum = getDisplaySeqNum(value)
          const nextDisplayCount = seqNum?.global ?? lastSeqRef.current + 1
          lastSeqRef.current = nextDisplayCount

          const id =
            seqNum !== undefined
              ? `seq-${seqNum.global}-${seqNum.client}-${seqNum.rebaseGeneration}`
              : `local-${nextDisplayCount}`
          const json = stringify(value)

          setStreamedCount(nextDisplayCount)
          setEvents((prev) => [{ id, json }, ...prev].slice(0, MAX_EVENT_ITEMS))
        }
      } catch (error) {
        console.error('Error consuming LiveStore events stream', error)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [preferredBatchSize, until, store])

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Live event stream</h2>
      <div>
        Events streamed: <span data-testid="events-streamed">{streamedCount}</span>
      </div>
      <ul style={listStyle} data-testid="event-stream-list">
        {events.map((event) => (
          <li key={event.id} style={listItemStyle}>
            {event.json}
          </li>
        ))}
      </ul>
      {events.length === 0 && <p style={emptyStateStyle}>No events yet. Start streaming to see incoming events.</p>}
    </section>
  )
}

/*
 * Directly itterate over events without rendering as list.
 * Saves 4-16% rendering time on larger event logs.
 */
export const SimpleEventsStream: React.FC<EventsListProps> = ({ batchSize, until }) => {
  const store = useAppStore()
  const [streamedCount, setStreamedCount] = React.useState(0)
  const preferredBatchSize = sanitizeBatchSize(batchSize)

  React.useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        for await (const event of store.events({
          batchSize: preferredBatchSize,
          ...(until !== undefined && { until: EventSequenceNumber.Client.fromString(`e${until}`) }),
        })) {
          if (cancelled === true) break
          if (event == null) continue
          setStreamedCount((prev) => prev + 1)
        }
      } catch (error) {
        console.error('Error consuming LiveStore simple events stream', error)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [preferredBatchSize, until, store])

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Live event stream</h2>
      <div>
        Events streamed: <span data-testid="events-streamed">{streamedCount}</span>
      </div>
    </section>
  )
}
