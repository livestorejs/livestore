import { useStore } from '@livestore/react'
import React from 'react'
import { todos$ } from '../livestore/queries.ts'
import type { TodoRow } from '../livestore/schema.ts'
import { events } from '../livestore/schema.ts'

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

const DEFAULT_TOTAL_EVENTS = 1000
const DEFAULT_EVENTS_PER_SECOND = 500
const EVENT_RATE_MIN = 1
const GENERATOR_INTERVAL_MS = 100
const STREAM_FLUSH_INTERVAL_MS = 16
const STREAM_FLUSH_BATCH_SIZE = 256

const makeRunId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`

const generateTodoText = (index: number) =>
  `${randomFrom(ADJECTIVES, index)} ${randomFrom(COLORS, index)} ${randomFrom(NOUNS, index)}`.replace(/\b\w/g, (char) =>
    char.toUpperCase(),
  )

type StreamingStatus = 'idle' | 'running' | 'stopped' | 'complete'
type GeneratorStatus = 'idle' | 'running' | 'stopped'

type TodoEventEntry = {
  id: string
  text: string
  source: 'seed' | 'generate'
  event: ReturnType<typeof events.todoCreated>
}

type QueueState = {
  items: TodoEventEntry[]
  head: number
}

const makeEmptyQueue = (): QueueState => ({ items: [], head: 0 })
const getQueueLength = (queue: QueueState) => queue.items.length - queue.head

type ControlState = {
  runId: string | null
  streamingStatus: StreamingStatus
  generatorStatus: GeneratorStatus
  queueLength: number
  generatedCount: number
  seededCount: number
  lastError: string | null
}

const initialControlState: ControlState = {
  runId: null,
  streamingStatus: 'idle',
  generatorStatus: 'idle',
  queueLength: 0,
  generatedCount: 0,
  seededCount: 0,
  lastError: null,
}

export const StreamControls: React.FC = () => {
  const { store } = useStore()
  const todos = store.useQuery(todos$) as ReadonlyArray<TodoRow>

  const [requestedTotalEvents, setRequestedTotalEvents] = React.useState<number>(DEFAULT_TOTAL_EVENTS)
  const [requestedEventsPerSecond, setRequestedEventsPerSecond] = React.useState<number>(DEFAULT_EVENTS_PER_SECOND)
  const [controlState, setControlState] = React.useState<ControlState>(initialControlState)

  const queueRef = React.useRef<QueueState>(makeEmptyQueue())
  const streamingRef = React.useRef<{ timerId: number | null }>({ timerId: null })
  const generatorRef = React.useRef<{ timerId: number | null; remaining: number; rate: number; lastTick: number }>({
    timerId: null,
    remaining: 0,
    rate: 0,
    lastTick: 0,
  })
  const idCounterRef = React.useRef<number>(1)
  const hasProcessedEventsRef = React.useRef<boolean>(false)
  const sessionIdRef = React.useRef<string>(makeRunId())

  const sanitizeRate = React.useCallback((value: number) => Math.max(EVENT_RATE_MIN, Math.floor(value)), [])

  const createTodoEntry = React.useCallback((source: 'seed' | 'generate'): TodoEventEntry => {
    const index = idCounterRef.current++
    const id = `${sessionIdRef.current}-todo-${index}`
    const text = `${generateTodoText(index)}`
    return { id, text, source, event: events.todoCreated({ id, text }) }
  }, [])

  const appendEntries = React.useCallback((entries: TodoEventEntry[], seedCount: number) => {
    if (entries.length === 0) return
    const queue = queueRef.current
    queue.items.push(...entries)
    const queueLength = getQueueLength(queue)
    setControlState((prev) => ({
      ...prev,
      queueLength,
      generatedCount: prev.generatedCount + entries.length,
      seededCount: prev.seededCount + seedCount,
    }))
  }, [])

  const stopStreamingInternal = React.useCallback((nextStatus: StreamingStatus) => {
    const timerId = streamingRef.current.timerId
    if (timerId !== null) {
      window.clearInterval(timerId)
      streamingRef.current.timerId = null
    }
    hasProcessedEventsRef.current = false
    setControlState((prev) => ({
      ...prev,
      streamingStatus: nextStatus,
      runId: nextStatus === 'idle' ? null : prev.runId,
    }))
  }, [])

  const stopGenerator = React.useCallback((nextStatus: GeneratorStatus) => {
    const ref = generatorRef.current
    if (ref.timerId !== null) {
      window.clearInterval(ref.timerId)
    }
    generatorRef.current = { timerId: null, remaining: 0, rate: 0, lastTick: 0 }
    setControlState((prev) => ({
      ...prev,
      generatorStatus: nextStatus,
    }))
  }, [])

  const stopStreamingWithError = React.useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      stopStreamingInternal('stopped')
      setControlState((prev) => ({
        ...prev,
        lastError: message,
      }))
    },
    [stopStreamingInternal],
  )

  const dequeueBatch = React.useCallback((max: number) => {
    const queue = queueRef.current
    const available = getQueueLength(queue)
    if (available <= 0) {
      return []
    }
    const take = Math.min(max, available)
    const slice = queue.items.slice(queue.head, queue.head + take)
    queue.head += take
    if (queue.head > 1024 && queue.head > queue.items.length / 2) {
      queue.items = queue.items.slice(queue.head)
      queue.head = 0
    }
    return slice
  }, [])

  const flushQueuedEvents = React.useCallback(() => {
    const batch = dequeueBatch(STREAM_FLUSH_BATCH_SIZE)
    if (batch.length === 0) {
      if (
        generatorRef.current.timerId === null &&
        generatorRef.current.remaining <= 0 &&
        getQueueLength(queueRef.current) === 0 &&
        hasProcessedEventsRef.current
      ) {
        if (streamingRef.current.timerId !== null) {
          stopStreamingInternal('complete')
        }
      }
      return
    }

    hasProcessedEventsRef.current = true

    try {
      batch.forEach((entry, index) => {
        const isLast = index === batch.length - 1
        if (isLast) {
          store.commit(entry.event)
        } else {
          store.commit({ skipRefresh: true }, entry.event)
        }
      })
    } catch (error) {
      stopStreamingWithError(error)
      return
    }

    const queueLength = getQueueLength(queueRef.current)
    setControlState((prev) => ({
      ...prev,
      queueLength,
    }))

    if (queueLength === 0 && generatorRef.current.timerId === null && generatorRef.current.remaining <= 0) {
      stopStreamingInternal('complete')
    }
  }, [dequeueBatch, stopStreamingInternal, stopStreamingWithError, store])

  const generateTick = React.useCallback(() => {
    const ref = generatorRef.current
    if (ref.remaining <= 0) {
      stopGenerator('idle')
      return
    }

    const now = performance.now()
    const delta = now - ref.lastTick
    ref.lastTick = now

    let toCreate = Math.max(1, Math.floor((ref.rate * delta) / 1000))
    toCreate = Math.min(toCreate, ref.remaining)

    const entries: TodoEventEntry[] = new Array(toCreate)
    for (let index = 0; index < toCreate; index++) {
      entries[index] = createTodoEntry('generate')
    }

    ref.remaining -= toCreate
    appendEntries(entries, 0)

    if (ref.remaining <= 0) {
      stopGenerator('idle')
    }
  }, [appendEntries, createTodoEntry, stopGenerator])

  const startStreaming = React.useCallback(() => {
    if (streamingRef.current.timerId !== null) {
      return
    }
    const runId = makeRunId()
    hasProcessedEventsRef.current = false
    setControlState((prev) => ({
      ...prev,
      runId,
      streamingStatus: 'running',
      lastError: null,
    }))
    if (typeof window !== 'undefined') {
      ;(window as any).__streamPerfStart = performance.now()
    }
    streamingRef.current.timerId = window.setInterval(flushQueuedEvents, STREAM_FLUSH_INTERVAL_MS)
    if (
      getQueueLength(queueRef.current) === 0 &&
      generatorRef.current.timerId === null &&
      generatorRef.current.remaining <= 0
    ) {
      // Nothing to stream yet; completion will be detected after generator adds work.
    }
  }, [flushQueuedEvents])

  const stopStreaming = React.useCallback(() => {
    stopStreamingInternal('stopped')
  }, [stopStreamingInternal])

  const startGenerator = React.useCallback(() => {
    if (generatorRef.current.timerId !== null) {
      return
    }

    const total = Math.max(0, Math.floor(requestedTotalEvents))
    if (total <= 0) {
      setControlState((prev) => ({
        ...prev,
        lastError: 'Enter a positive number of events before starting generation.',
      }))
      return
    }

    const rate = sanitizeRate(requestedEventsPerSecond)
    generatorRef.current = {
      timerId: window.setInterval(generateTick, GENERATOR_INTERVAL_MS),
      remaining: total,
      rate,
      lastTick: performance.now(),
    }

    setControlState((prev) => ({
      ...prev,
      generatorStatus: 'running',
      lastError: null,
    }))
  }, [generateTick, requestedEventsPerSecond, requestedTotalEvents, sanitizeRate])

  const stopGeneratorManually = React.useCallback(() => {
    if (generatorRef.current.timerId === null) {
      return
    }
    stopGenerator('stopped')
  }, [stopGenerator])

  const seedEvents = React.useCallback(
    (count: number) => {
      if (count <= 0) return
      const entries: TodoEventEntry[] = new Array(count)
      for (let index = 0; index < count; index++) {
        entries[index] = createTodoEntry('seed')
      }
      appendEntries(entries, count)
    },
    [appendEntries, createTodoEntry],
  )

  const handleResetHarness = React.useCallback(() => {
    stopStreamingInternal('idle')
    stopGenerator('idle')
    queueRef.current = makeEmptyQueue()
    generatorRef.current = { timerId: null, remaining: 0, rate: 0, lastTick: 0 }
    streamingRef.current = { timerId: null }
    idCounterRef.current = 1
    sessionIdRef.current = makeRunId()
    hasProcessedEventsRef.current = false
    setControlState(initialControlState)
    setRequestedTotalEvents(DEFAULT_TOTAL_EVENTS)
    setRequestedEventsPerSecond(DEFAULT_EVENTS_PER_SECOND)

    const activeTodos = todos.filter((todo) => todo.deletedAt === null)
    if (activeTodos.length === 0) {
      return
    }

    const deletedAt = new Date()
    const deletions = activeTodos.map((todo) => events.todoDeleted({ id: todo.id, deletedAt }))

    deletions.forEach((event, index) => {
      const isLast = index === deletions.length - 1
      if (isLast) {
        store.commit(event)
      } else {
        store.commit({ skipRefresh: true }, event)
      }
    })
  }, [stopGenerator, stopStreamingInternal, store, todos])

  React.useEffect(() => {
    return () => {
      if (streamingRef.current.timerId !== null) {
        window.clearInterval(streamingRef.current.timerId)
        streamingRef.current.timerId = null
      }
      if (generatorRef.current.timerId !== null) {
        window.clearInterval(generatorRef.current.timerId)
        generatorRef.current.timerId = null
      }
    }
  }, [])

  const sanitizedTotalEvents = Math.max(0, Math.floor(requestedTotalEvents))
  const sanitizedRate = sanitizeRate(requestedEventsPerSecond)

  return (
    <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
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
        <button
          type="button"
          data-testid="start-generate"
          onClick={startGenerator}
          disabled={controlState.generatorStatus === 'running'}
        >
          Start generate
        </button>
        <button
          type="button"
          data-testid="stop-generate"
          onClick={stopGeneratorManually}
          disabled={controlState.generatorStatus !== 'running'}
        >
          Stop generate
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="start-stream"
          onClick={startStreaming}
          disabled={controlState.streamingStatus === 'running'}
        >
          Start streaming
        </button>
        <button
          type="button"
          data-testid="stop-stream"
          onClick={stopStreaming}
          disabled={controlState.streamingStatus !== 'running'}
        >
          Stop streaming
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
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

      <div
        style={{
          marginTop: '1rem',
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
        data-testid="generator-status"
        data-generator-status={controlState.generatorStatus}
        data-flush-status={controlState.streamingStatus}
        data-queue-length={controlState.queueLength}
        data-generated-count={controlState.generatedCount}
        data-seeded-count={controlState.seededCount}
        data-run-id={controlState.runId ?? ''}
        data-rate={sanitizedRate}
      >
        <span>Generator: {controlState.generatorStatus === 'running' ? 'Running' : controlState.generatorStatus}</span>
        <span>Flush loop: {controlState.streamingStatus === 'running' ? 'Running' : controlState.streamingStatus}</span>
        <span>Queue: {controlState.queueLength.toLocaleString()}</span>
        <span>Generated: {controlState.generatedCount.toLocaleString()}</span>
        <span>Seeded: {controlState.seededCount.toLocaleString()}</span>
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="reset-harness"
          onClick={handleResetHarness}
          disabled={controlState.streamingStatus === 'running' || controlState.generatorStatus === 'running'}
        >
          Reset harness
        </button>
        <span data-testid="todo-count-meta">
          Todos: {todos.filter((todo) => todo.deletedAt === null).length.toLocaleString()}
        </span>
      </div>

      {controlState.lastError && (
        <p style={{ color: 'red', marginTop: '0.75rem' }} data-testid="stream-error">
          {controlState.lastError}
        </p>
      )}
    </section>
  )
}
