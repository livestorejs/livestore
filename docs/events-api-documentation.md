# LiveStore Events API

## Overview

The LiveStore Events API provides two methods for accessing the event stream:
- `store.events()` - Returns an async iterable for consuming events
- `store.eventsStream()` - Returns an Effect Stream for more advanced use cases

## API Reference

### `store.events(options?)`

Returns an async iterable that yields events from the store.

**Parameters:**
- `options` (optional): Configuration object
  - `cursor?: EventSequenceNumber.Client` - Starting position in the event stream. Use `EventSequenceNumber.Client.ROOT` to get all events from the beginning
  - `filter?: string[]` - Array of event names to include. If not specified, all events are included
  - `includeClientOnly?: boolean` - Whether to include client-only events (default: true)

**Returns:** `AsyncIterable<LiveStoreEvent>`

**Example:**
```typescript
// Get all new events as they arrive
for await (const event of store.events()) {
  console.log('New event:', event.name, event.args)
}

// Get all events from the beginning
for await (const event of store.events({ cursor: EventSequenceNumber.Client.ROOT })) {
  console.log('Event:', event.name, event.args)
}

// Filter specific event types
for await (const event of store.events({ filter: ['todoCreated', 'todoCompleted'] })) {
  console.log('Todo event:', event.name, event.args)
}
```

### `store.eventsStream(options?)`

Returns an Effect Stream of events from the store.

**Parameters:**
- Same as `store.events()`

**Returns:** `Stream.Stream<LiveStoreEvent>`

**Example:**
```typescript
import { Effect, Stream, Console } from 'effect'

// Basic usage
const stream = store.eventsStream()
  .pipe(
    Stream.tap((event) => Console.log('Event:', event.name)),
    Stream.take(10), // Take first 10 events
  )

await Effect.runPromise(Stream.runDrain(stream))

// Transform and filter events
const completedTodos = store.eventsStream({ filter: ['todoCompleted'] })
  .pipe(
    Stream.map((event) => event.args.id),
    Stream.tap((todoId) => Console.log('Completed:', todoId)),
  )
```

## Use Cases

### 1. Real-time Event Log UI

```typescript
function EventLog({ store }) {
  const [events, setEvents] = useState([])

  useEffect(() => {
    const subscription = store.subscribe(
      store.eventsStream(),
      {
        onUpdate: (event) => {
          setEvents(prev => [...prev, event])
        },
        label: 'event-log'
      }
    )

    return () => subscription()
  }, [store])

  return (
    <div>
      {events.map((event, i) => (
        <div key={i}>{event.name}</div>
      ))}
    </div>
  )
}
```

### 2. Analytics and Monitoring

```typescript
// Count events by type
const eventCounts = await store.eventsStream()
  .pipe(
    Stream.groupBy((event) => event.name),
    Stream.map(([name, events]) =>
      Stream.fromIterable(events).pipe(
        Stream.runCount,
        Effect.map(count => ({ name, count }))
      )
    ),
    Stream.runCollect,
    Effect.map(chunks => [...chunks])
  )
```

### 3. Event Replay for Testing

```typescript
// Capture events for replay
const recordedEvents = []
for await (const event of store.events()) {
  recordedEvents.push(event)
  if (recordedEvents.length >= 100) break
}

// Replay events in another store
for (const event of recordedEvents) {
  testStore.commit(event)
}
```

## Implementation Notes

### Current Limitations

**Confirmed Events Only**: Currently, the implementation only has access to events that have been confirmed by the sync backend.

### Future Enhancements

To fully implement the events API, we would need to:

1. **Support streaming on client and leader level**: A first version of this would likely involve ending the stream when a rebase occurs with an error that describes the cause.
2. **Support streaming unconfirmed events**: Requires careful consideration on how to adapt the stream when a rebase occurs. Further research is required in order to determine what the expected behaviour in this sceneario shoudl be. If unconfirmed events have already been emitted from the stream there is no way to retract them so the stream can either restart from the point in the stream where the events diverged and re-stream events or only continue emitting new events.

### Performance Considerations

- The events API creates a subscription to the sync state changes
- Each subscription maintains its own cursor position