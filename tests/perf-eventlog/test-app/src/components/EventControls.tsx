import { Devtools, liveStoreVersion } from '@livestore/common'
import { StoreInternalsSymbol } from '@livestore/livestore'
import { Effect, Stream } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import React from 'react'
import { events, tables } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'

const ADJECTIVES = [
  'agile',
  'brisk',
  'curious',
  'daring',
  'eager',
  'friendly',
  'gentle',
  'humble',
  'inventive',
  'jolly',
  'kind',
  'lively',
  'mighty',
  'neat',
  'optimistic',
  'patient',
  'quick',
  'radiant',
  'sharp',
  'tidy',
  'upbeat',
  'vivid',
  'witty',
  'youthful',
  'zealous',
]

const NOUNS = [
  'acorn',
  'bridge',
  'compass',
  'daisy',
  'ember',
  'feather',
  'grove',
  'harbor',
  'island',
  'journey',
  'lantern',
  'meadow',
  'notebook',
  'orchard',
  'petal',
  'quartz',
  'river',
  'sprout',
  'trail',
  'universe',
  'valley',
  'willow',
  'xylophone',
  'yarrow',
  'zephyr',
]

const COLORS = ['amber', 'burgundy', 'cerulean', 'denim', 'emerald', 'fuchsia', 'golden', 'hazel', 'indigo', 'jade']

const randomFrom = (items: readonly string[], seed: number) => items[seed % items.length]!

export const DEFAULT_EVENT_BATCH_SIZE = 1000
const DEFAULT_TOTAL_EVENTS = 1000
const DEFAULT_EVENTS_PER_SECOND = 500
const EVENT_RATE_MIN = 1
const EVENT_BATCH_SIZE_MIN = 1
const GENERATOR_INTERVAL_MS = 100

const makeRunId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`

const generateTodoText = (index: number) =>
  `${randomFrom(ADJECTIVES, index)} ${randomFrom(COLORS, index)} ${randomFrom(NOUNS, index)}`.replace(/\b\w/g, (char) =>
    char.toUpperCase(),
  )

type EventControlsProps = {
  eventsVisible: boolean
  onEventsVisibleChange: (visible: boolean) => void
  eventBatchSize: number
  onEventBatchSizeChange: (size: number) => void
  eventUntil: number | undefined
  onEventUntilChange: (until: number | undefined) => void
}

type GeneratorState = {
  timerId: number | null
  remaining: number
  rate: number
}

type SnapshotPayload = {
  state: ArrayBuffer | Uint8Array<ArrayBuffer>
  eventlog: ArrayBuffer | Uint8Array<ArrayBuffer>
}

type StoreInstance = ReturnType<typeof useAppStore>

const readSyncHeadSnapshot = (store: StoreInstance) => {
  try {
    const syncState = store[StoreInternalsSymbol].syncProcessor.syncState.pipe(Effect.runSync)
    return {
      local: syncState.localHead.global,
      upstream: syncState.upstreamHead.global,
    }
  } catch {
    return { local: 0, upstream: 0 }
  }
}

const normalizeSnapshot = (input: SnapshotPayload['state']) =>
  input instanceof Uint8Array ? input : new Uint8Array(input)

const loadSnapshots = async (store: StoreInstance, { state, eventlog }: SnapshotPayload) => {
  const clientSession = store[StoreInternalsSymbol].clientSession
  const clientId = clientSession.clientId
  const batchId = `perf-${makeRunId()}`

  const send = (data: Uint8Array<ArrayBuffer>) =>
    clientSession.leaderThread
      .sendDevtoolsMessage(
        Devtools.Leader.LoadDatabaseFile.Request.make({
          clientId,
          requestId: nanoid(),
          data,
          batchId,
          liveStoreVersion,
        }),
      )
      .pipe(Effect.runPromise)

  const normalizedState = normalizeSnapshot(state)
  const normalizedEventlog = normalizeSnapshot(eventlog)

  await send(normalizedState)
  await send(normalizedEventlog)
}

const makeGeneratorState = (): GeneratorState => ({
  timerId: null,
  remaining: 0,
  rate: DEFAULT_EVENTS_PER_SECOND,
})

const sanitizeRate = (value: number) => Math.max(EVENT_RATE_MIN, Math.floor(value))

export const EventControls: React.FC<EventControlsProps> = ({
  eventsVisible,
  onEventsVisibleChange,
  eventBatchSize,
  onEventBatchSizeChange,
  eventUntil,
  onEventUntilChange,
}) => {
  const store = useAppStore()

  const todoCount = store.useQuery(tables.todos.count())

  const [requestedTotalEvents, setRequestedTotalEvents] = React.useState<number>(DEFAULT_TOTAL_EVENTS)
  const [requestedEventsPerSecond, setRequestedEventsPerSecond] = React.useState<number>(DEFAULT_EVENTS_PER_SECOND)
  const [isGenerating, setIsGenerating] = React.useState<boolean>(false)
  const [lastError, setLastError] = React.useState<string | null>(null)
  const [stateSnapshot, setStateSnapshot] = React.useState<File | null>(null)
  const [eventlogSnapshot, setEventlogSnapshot] = React.useState<File | null>(null)
  const [snapshotStatus, setSnapshotStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [snapshotError, setSnapshotError] = React.useState<string | null>(null)
  const [syncHead, setSyncHead] = React.useState(() => readSyncHeadSnapshot(store))

  const generatorRef = React.useRef<GeneratorState>(makeGeneratorState())
  const sessionIdRef = React.useRef<string>(makeRunId())
  const idCounterRef = React.useRef<number>(1)

  const createTodoEvent = () => {
    const index = idCounterRef.current++
    const id = crypto.randomUUID()
    const text = generateTodoText(index)
    return events.todoCreated({ id, text })
  }

  const commitEvents = (items: ReadonlyArray<ReturnType<typeof events.todoCreated>>) => {
    if (items.length === 0) return
    store.commit(...items)
  }

  const createSingleEvent = () => {
    commitEvents([createTodoEvent()])
  }

  const stopGenerator = () => {
    const ref = generatorRef.current
    if (ref.timerId !== null) {
      window.clearInterval(ref.timerId)
    }
    generatorRef.current = makeGeneratorState()
    setIsGenerating(false)
  }

  const runGeneratorTick = () => {
    const ref = generatorRef.current
    if (ref.remaining <= 0) {
      stopGenerator()
      return
    }

    const perTick = Math.min(ref.remaining, Math.max(1, Math.floor((ref.rate * GENERATOR_INTERVAL_MS) / 1000)))

    const eventsToCommit = Array.from({ length: perTick }, () => createTodoEvent())

    ref.remaining -= perTick
    commitEvents(eventsToCommit)

    if (ref.remaining <= 0) {
      stopGenerator()
    }
  }

  const startGenerator = () => {
    if (generatorRef.current.timerId !== null) {
      return
    }

    const total = Math.max(0, Math.floor(requestedTotalEvents))
    if (total <= 0) {
      setLastError('Enter a positive number of events before starting generation.')
      return
    }

    const rate = sanitizeRate(requestedEventsPerSecond)
    generatorRef.current = {
      timerId: window.setInterval(runGeneratorTick, GENERATOR_INTERVAL_MS),
      remaining: total,
      rate,
    }

    setIsGenerating(true)
    setLastError(null)
  }

  const seedEvents = (count: number) => {
    if (count <= 0) return
    const eventsToCommit = Array.from({ length: count }, () => createTodoEvent())
    commitEvents(eventsToCommit)
  }

  const handleResetHarness = () => {
    stopGenerator()
    setRequestedTotalEvents(DEFAULT_TOTAL_EVENTS)
    setRequestedEventsPerSecond(DEFAULT_EVENTS_PER_SECOND)
    setLastError(null)
    sessionIdRef.current = makeRunId()
    idCounterRef.current = 1
    onEventBatchSizeChange(DEFAULT_EVENT_BATCH_SIZE)
    onEventUntilChange(undefined)
    // Use the same reset mechanism as devtools - triggers clean shutdown and page reload
    store._dev.hardReset('all-data')
  }

  const handleLoadSnapshotFiles = async () => {
    if (stateSnapshot === null || eventlogSnapshot === null) {
      setSnapshotStatus('error')
      setSnapshotError('Select both state and eventlog files before loading.')
      return
    }

    setSnapshotStatus('loading')
    setSnapshotError(null)

    try {
      const [stateBuffer, eventlogBuffer] = await Promise.all([
        stateSnapshot.arrayBuffer(),
        eventlogSnapshot.arrayBuffer(),
      ])

      await loadSnapshots(store, {
        state: stateBuffer,
        eventlog: eventlogBuffer,
      })

      setSnapshotStatus('success')
    } catch (error) {
      console.error('Failed to load snapshots', error)
      setSnapshotStatus('error')
      setSnapshotError(error instanceof Error ? error.message : 'Unknown error while loading snapshots.')
    }
  }

  React.useEffect(() => {
    const harness = {
      loadSnapshots: (payload: SnapshotPayload) => loadSnapshots(store, payload),
    }

    ;(window as any).__livestorePerfHarness = harness

    return () => {
      if ((window as any).__livestorePerfHarness === harness) {
        delete (window as any).__livestorePerfHarness
      }
    }
  }, [store])

  React.useEffect(() => {
    return () => {
      const ref = generatorRef.current
      if (ref.timerId !== null) {
        window.clearInterval(ref.timerId)
      }
    }
  }, [])

  React.useEffect(() => {
    const cancel = store[StoreInternalsSymbol].syncProcessor.syncState.changes.pipe(
      Stream.runForEach((state) =>
        Effect.sync(() =>
          setSyncHead({
            local: state.localHead.global,
            upstream: state.upstreamHead.global,
          }),
        ),
      ),
      Effect.interruptible,
      Effect.runCallback,
    )

    return () => {
      cancel()
    }
  }, [store])

  const sanitizedTotalEvents = Math.max(0, Math.floor(requestedTotalEvents))
  const sanitizedRate = sanitizeRate(requestedEventsPerSecond)
  const sanitizedBatchSize = Math.max(EVENT_BATCH_SIZE_MIN, Math.floor(eventBatchSize))

  return (
    <section>
      <div style={{ fontSize: '0.9rem', display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ width: '10rem' }} data-testid="syncstate">
          {todoCount === syncHead.upstream ? 'Synced' : 'Syncing...'}
        </div>
        <div style={{ width: '10rem' }}>
          Todo count: {typeof todoCount === 'number' ? todoCount.toLocaleString() : String(todoCount ?? '')}
        </div>
        <div style={{ width: '10rem' }}>Upstream head: {syncHead.upstream}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Number of events
          <input
            type="number"
            min={0}
            value={sanitizedTotalEvents}
            data-testid="config-total"
            onChange={(event) => setRequestedTotalEvents(Number.parseInt(event.target.value, 10) || 0)}
            style={{ width: '8rem' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Events per second
          <input
            type="number"
            min={EVENT_RATE_MIN}
            value={sanitizedRate}
            data-testid="config-rate"
            onChange={(event) =>
              setRequestedEventsPerSecond(
                Math.max(EVENT_RATE_MIN, Number.parseInt(event.target.value, 10) || EVENT_RATE_MIN),
              )
            }
            style={{ width: '8rem' }}
          />
        </label>
        <button type="button" data-testid="start-generator" onClick={startGenerator} disabled={isGenerating}>
          Start timed generation
        </button>
        <button type="button" data-testid="stop-generator" onClick={stopGenerator} disabled={!isGenerating}>
          Stop timed generation
        </button>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button type="button" data-testid="create-single-event" onClick={() => createSingleEvent()}>
          Create event
        </button>
        <button type="button" data-testid="seed-500" onClick={() => seedEvents(500)}>
          Seed 500
        </button>
        <button type="button" data-testid="seed-1k" onClick={() => seedEvents(1_000)}>
          Seed 1,000
        </button>
        <button type="button" data-testid="seed-10k" onClick={() => seedEvents(10_000)}>
          Seed 10,000
        </button>
        <button type="button" data-testid="seed-100k" onClick={() => seedEvents(100_000)}>
          Seed 100,000
        </button>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', alignItems: 'end' }}>
        <button type="button" data-testid="toggle-events" onClick={() => onEventsVisibleChange(!eventsVisible)}>
          {eventsVisible ? 'Hide events stream' : 'Show events stream'}
        </button>
        <button type="button" data-testid="reset-harness" onClick={handleResetHarness} disabled={isGenerating}>
          Reset harness
        </button>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Stream batch size
          <input
            type="number"
            min={EVENT_BATCH_SIZE_MIN}
            value={sanitizedBatchSize}
            data-testid="config-batch"
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10)
              onEventBatchSizeChange(
                Number.isFinite(next) ? Math.max(EVENT_BATCH_SIZE_MIN, next) : EVENT_BATCH_SIZE_MIN,
              )
            }}
            style={{ width: '8rem' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Stream until (global seq)
          <input
            type="number"
            min={0}
            value={eventUntil ?? ''}
            placeholder="∞"
            data-testid="config-until"
            onChange={(event) => {
              const raw = event.target.value.trim()
              if (raw === '') {
                onEventUntilChange(undefined)
              } else {
                const next = Number.parseInt(raw, 10)
                onEventUntilChange(Number.isFinite(next) && next >= 0 ? next : undefined)
              }
            }}
            style={{ width: '8rem' }}
          />
        </label>
      </div>
      <section style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #ddd' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Load snapshots</h2>
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Select matching state and eventlog SQLite snapshots exported from LiveStore Devtools to instantly load large
          datasets.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
            State DB
            <input
              type="file"
              accept=".db"
              data-testid="snapshot-state-input"
              onChange={(event) => setStateSnapshot(event.target.files?.[0] ?? null)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
            Eventlog DB
            <input
              type="file"
              accept=".db"
              data-testid="snapshot-eventlog-input"
              onChange={(event) => setEventlogSnapshot(event.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            data-testid="load-snapshots"
            onClick={handleLoadSnapshotFiles}
            disabled={snapshotStatus === 'loading'}
          >
            {snapshotStatus === 'loading' ? 'Loading snapshots…' : 'Load snapshots'}
          </button>
        </div>
        {snapshotStatus === 'success' && (
          <p style={{ color: 'green', marginTop: '0.5rem' }} data-testid="snapshot-load-status">
            Snapshots loaded. Harness will restart automatically.
          </p>
        )}
        {snapshotStatus === 'error' && snapshotError && (
          <p style={{ color: 'red', marginTop: '0.5rem' }} data-testid="snapshot-load-error">
            {snapshotError}
          </p>
        )}
      </section>
      {lastError && (
        <p style={{ color: 'red', marginTop: '0.75rem' }} data-testid="event-error">
          {lastError}
        </p>
      )}
    </section>
  )
}
