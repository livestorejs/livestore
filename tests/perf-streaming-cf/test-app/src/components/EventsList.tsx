import { useStore } from '@livestore/react'
import React from 'react'

const MAX_EVENT_ITEMS = 500

type DisplayEvent = {
  id: string
  json: string
}

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    return typeof value === 'string' ? value : String(error)
  }
}

export const EventsList: React.FC = () => {
  const { store } = useStore()
  const [events, setEvents] = React.useState<ReadonlyArray<DisplayEvent>>([])
  const counterRef = React.useRef(0)

  React.useEffect(() => {
    let cancelled = false
    const iterator = store.events()[Symbol.asyncIterator]()

    const run = async () => {
      try {
        while (!cancelled) {
          const { value, done } = await iterator.next()
          if (done || cancelled) break
          if (!value) continue

          const id = `${counterRef.current++}-${value.seqNum ?? 'unknown'}`
          const json = stringify(value)

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
  }, [store])

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2 style={{ margin: '0 0 0.75rem 0' }}>Live event stream</h2>
      <div>
        Events streamed: <span data-testid="events-streamed">{counterRef.current}</span>
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
