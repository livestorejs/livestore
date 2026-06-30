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

type EventSeqNum = {
  global?: unknown
  client?: unknown
  rebaseGeneration?: unknown
}

type EventsListProps = {
  batchSize: number
  /** When set, the stream stops after reaching this global sequence number */
  until: number | undefined
}

const sanitizeBatchSize = (value: number) => Math.max(1, Math.floor(value) || 1)

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    return typeof value === 'string' ? value : String(error)
  }
}

const getSeqNum = (value: unknown): EventSeqNum | undefined => {
  if (typeof value !== 'object' || value === null || 'seqNum' in value === false) {
    return undefined
  }

  const seqNum = (value as { seqNum?: unknown }).seqNum
  return typeof seqNum === 'object' && seqNum !== null ? seqNum : undefined
}

export const EventsList: React.FC<EventsListProps> = ({ batchSize, until }) => {
  const store = useAppStore()
  const [events, setEvents] = React.useState<ReadonlyArray<DisplayEvent>>([])
  const [streamedCount, setStreamedCount] = React.useState(0)
  const lastSeqRef = React.useRef(0)
  const preferredBatchSize = sanitizeBatchSize(batchSize)

  React.useEffect(() => {
    const streamState: { cancelled: boolean } = { cancelled: false }
    lastSeqRef.current = 0
    const iterator = store
      .events({
        batchSize: preferredBatchSize,
        ...(until !== undefined && { until: EventSequenceNumber.Client.fromString(`e${until}`) }),
      })
      [Symbol.asyncIterator]()

    const run = async () => {
      try {
        while (streamState.cancelled === false) {
          const result = await iterator.next()
          if (result.done === true || streamState.cancelled) break
          const { value } = result
          if (value == null) continue

          const seqNum = getSeqNum(value)
          const seqNumGlobal = typeof seqNum?.global === 'number' ? seqNum.global : null
          const seqNumClient = typeof seqNum?.client === 'number' ? seqNum.client : null
          const seqNumRebase = typeof seqNum?.rebaseGeneration === 'number' ? seqNum.rebaseGeneration : null
          const nextDisplayCount = seqNumGlobal ?? lastSeqRef.current + 1
          lastSeqRef.current = nextDisplayCount

          const id =
            seqNumGlobal !== null
              ? `seq-${seqNumGlobal}-${seqNumClient ?? 'client'}-${seqNumRebase ?? 'rebase'}`
              : `local-${nextDisplayCount}`
          const json = stringify(value)

          setStreamedCount(nextDisplayCount)
          setEvents((prev) => [{ id, json }, ...prev].slice(0, MAX_EVENT_ITEMS))
        }
      } catch (error) {
        console.error('Error consuming LiveStore events stream', error)
      } finally {
        await iterator.return?.()
      }
    }

    void run()

    return () => {
      streamState.cancelled = true
      void iterator.return?.()
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
