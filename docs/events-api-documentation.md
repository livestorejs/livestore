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
  - `cursor?: EventSequenceNumber` - Starting position in the event stream. Use `EventSequenceNumber.ROOT` to get all events from the beginning
  - `filter?: string[]` - Array of event names to include. If not specified, all events are included
  - `includeClientOnly?: boolean` - Whether to include client-only events (default: true)
  - `excludeUnpushed?: boolean` - Whether to exclude events that haven't been pushed to the sync backend yet (default: false)

**Returns:** `AsyncIterable<LiveStoreEvent>`

**Example:**
```typescript
// Get all new events as they arrive
for await (const event of store.events()) {
  console.log('New event:', event.name, event.args)
}

// Get all events from the beginning
for await (const event of store.events({ cursor: EventSequenceNumber.ROOT })) {
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

### 4. Sync Status Indicator

```typescript
// Show unpushed changes
const unpushedStream = store.eventsStream({ excludeUnpushed: false })
  .pipe(
    Stream.scan(0, (count) => count + 1),
    Stream.map(count => `${count} unpushed changes`)
  )
```

## Implementation Notes

### Current Limitations

1. **Pending Events Only**: Currently, the implementation only has access to pending (unpushed) events in the sync state. Historical events that have been synced are not yet accessible.

2. **No Persistent Event Log**: The current implementation doesn't query the leader thread's eventlog database. This means:
   - Events are only available while they're in the pending state
   - Once events are synced and removed from pending, they're no longer accessible
   - The `cursor` option with `EventSequenceNumber.ROOT` will only show current pending events

3. **Client-Only Events**: Events marked as `clientOnly` are never synced and will always remain in the pending state.

### Future Enhancements

To fully implement the events API, we would need to:

1. **Query Historical Events**: Add the ability to query the leader thread's eventlog database for historical events
2. **Combine Streams**: Merge historical events with the live stream of new events
3. **Efficient Cursors**: Implement efficient cursor-based pagination for large event histories
4. **Event Metadata**: Include additional metadata like timestamps, sync status, etc.

### Performance Considerations

- The events API creates a subscription to the sync state changes
- Each subscription maintains its own cursor position
- Filtering is done on the client side after receiving events
- For large event streams, consider using `Stream.take()` or implementing pagination

## Related APIs

- `store.commit()` - Add new events to the store
- `store.subscribe()` - Subscribe to query results
- `store.syncProcessor.syncState` - Access the current sync state directly