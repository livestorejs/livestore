import { EventSequenceNumber } from '@livestore/common/schema'
import { useStore } from '@livestore/react'
import React from 'react'

const MAX_EVENT_ITEMS = 500

type DisplayEvent = {
  id: string
  json: string
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

export const EventsList: React.FC<EventsListProps> = ({ batchSize, until }) => {
  const { store } = useStore()
  const [events, setEvents] = React.useState<ReadonlyArray<DisplayEvent>>([])
  const [streamedCount, setStreamedCount] = React.useState(0)
  const lastSeqRef = React.useRef(0)
  const preferredBatchSize = sanitizeBatchSize(batchSize)

  React.useEffect(() => {
    let cancelled = false
    lastSeqRef.current = 0
    const iterator = store
      .events({
        batchSize: preferredBatchSize,
        ...(until !== undefined && { until: EventSequenceNumber.fromString(`e${until}`) }),
      })
      [Symbol.asyncIterator]()

    const run = async () => {
      try {
        while (!cancelled) {
          const { value, done } = await iterator.next()
          if (done || cancelled) break
          if (!value) continue

          const seqNumGlobal = typeof value.seqNum?.global === 'number' ? value.seqNum.global : null
          const seqNumClient = typeof value.seqNum?.client === 'number' ? value.seqNum.client : null
          const seqNumRebase = typeof value.seqNum?.rebaseGeneration === 'number' ? value.seqNum.rebaseGeneration : null
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
      cancelled = true
      void iterator.return?.()
    }
  }, [preferredBatchSize, until, store])

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2 style={{ margin: '0 0 0.75rem 0' }}>Live event stream</h2>
      <div>
        Events streamed: <span data-testid="events-streamed">{streamedCount}</span>
      </div>
      <ul
        style={{ maxHeight: '26rem', overflowY: 'auto', padding: 0, listStyle: 'none', margin: 0 }}
        data-testid="event-stream-list"
      >
        {events.map((event) => (
          <li
            key={event.id}
            style={{
              borderBottom: '1px solid #ddd',
              padding: '0.5rem 0.25rem',
              fontFamily:
                'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: '0.85rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {event.json}
          </li>
        ))}
      </ul>
      {events.length === 0 && <p style={{ color: '#555' }}>No events yet. Start streaming to see incoming events.</p>}
    </section>
  )
}

/*
 * Directly itterate over events without rendering as list.
 * Saves 4-16% rendering time on larger event logs.
 */
export const SimpleEventsStream: React.FC<EventsListProps> = ({ batchSize, until }) => {
  const { store } = useStore()
  const [streamedCount, setStreamedCount] = React.useState(0)
  const preferredBatchSize = sanitizeBatchSize(batchSize)

  React.useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        for await (const event of store.events({
          batchSize: preferredBatchSize,
          ...(until !== undefined && { until: EventSequenceNumber.fromString(`e${until}`) }),
        })) {
          if (cancelled) break
          if (!event) continue
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
    <section style={{ marginTop: '1.5rem' }}>
      <h2 style={{ margin: '0 0 0.75rem 0' }}>Live event stream</h2>
      <div>
        Events streamed: <span data-testid="events-streamed">{streamedCount}</span>
      </div>
    </section>
  )
}
