import { useStore } from '@livestore/react'
import React from 'react'

import { events } from '../livestore/events.ts'
import { activeRun$ } from '../livestore/queries.ts'
import type { StreamRun } from '../livestore/schema.ts'

const ADJECTIVES = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
]

const COLORS = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'white', 'black', 'orange']

const NOUNS = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
]

const randomFrom = (items: readonly string[], seed: number) => items[seed % items.length]!

const DEFAULT_EVENT_COUNT = 1000
const createDatasetId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `dataset-${Date.now()}-${Math.random().toString(16).slice(2)}`

type ControlState = {
  isStreaming: boolean
  datasetId: string | null
  lastError: string | null
}

const initialState: ControlState = {
  isStreaming: false,
  datasetId: null,
  lastError: null,
}

export const StreamControls: React.FC = () => {
  const { store } = useStore()
  const activeRun = store.useQuery(activeRun$) as StreamRun | null
  const [state, setState] = React.useState<ControlState>(initialState)

  const emitEvents = React.useCallback(
    (count: number) => {
      if (state.isStreaming) return

      const datasetId = createDatasetId()
      setState({ isStreaming: true, datasetId, lastError: null })

      try {
        store.commit(events.streamRunStarted({ datasetId, totalEvents: count }))

        for (let sequence = 1; sequence <= count; sequence++) {
          const label = `${randomFrom(ADJECTIVES, sequence)} ${randomFrom(COLORS, sequence)} ${randomFrom(NOUNS, sequence)}`
          const shouldSkipRefresh = sequence < count
          if (shouldSkipRefresh) {
            store.commit({ skipRefresh: true }, events.streamEventRecorded({ datasetId, sequence, label }))
          } else {
            store.commit(events.streamEventRecorded({ datasetId, sequence, label }))
          }
        }
        if (count > 0) {
          store.manualRefresh()
        }
      } catch (error) {
        setState((prev) => ({
          ...prev,
          lastError: error instanceof Error ? error.message : String(error),
        }))
      } finally {
        setState((prev) => ({ ...prev, isStreaming: false }))
      }
    },
    [state.isStreaming, store],
  )

  const clearActiveRun = React.useCallback(async () => {
    if (!activeRun) return
    await store.commit(events.streamRunCleared({ datasetId: activeRun.datasetId }))
    setState(initialState)
  }, [activeRun, store])

  return (
    <section>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button
          id="emit-default"
          type="button"
          data-testid="emit-default"
          onClick={() => emitEvents(DEFAULT_EVENT_COUNT)}
          disabled={state.isStreaming}
        >
          Emit {DEFAULT_EVENT_COUNT.toLocaleString()} events
        </button>
        <button
          id="clear-run"
          type="button"
          data-testid="clear-run"
          onClick={clearActiveRun}
          disabled={state.isStreaming || !activeRun}
        >
          Clear active run
        </button>
        <span data-testid="stream-status">
          {state.isStreaming ? 'Streaming in progress' : activeRun ? `Last dataset: ${activeRun.datasetId}` : 'Idle'}
        </span>
      </div>
      {activeRun && (
        <p style={{ marginTop: '0.5rem', color: '#555', fontSize: '0.9rem' }} data-testid="active-run-meta">
          Active dataset expects {activeRun.totalEvents.toLocaleString()} events.
        </p>
      )}
      {state.lastError && (
        <p style={{ color: 'red' }} data-testid="stream-error">
          {state.lastError}
        </p>
      )}
    </section>
  )
}
