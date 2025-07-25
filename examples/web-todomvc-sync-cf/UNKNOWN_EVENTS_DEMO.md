# Unknown Events Demo - TodoMVC SyncCF

This example demonstrates the proposed unknown event handling API for LiveStore. The approach uses a single synchronous callback function for maximum simplicity and control.

## What's New

### Simplified API (`src/livestore/schema.ts`)

The API uses a single `onUnknownEvent` callback property:

```typescript
makeSchema({
  events,
  state,
  onUnknownEvent?: (context: UnknownEventContext) => UnknownEventResult
})
```

#### Default Behavior (No Callback)
```typescript
// Schema 1: Default behavior - logs warning and continues
export const schema1 = makeSchema({ 
  events, 
  state
  // No onUnknownEvent = default warning logging
})
```

#### Custom Callback Examples
```typescript
// Schema 2: Migration logic
export const schema2 = makeSchema({ 
  events, 
  state,
  onUnknownEvent: ({ eventName, eventData, availableEvents }) => {
    const migrations = {
      'TodoAdded': 'v1.TodoCreated',
      'TodoToggled': 'v1.TodoCompleted'
    }
    
    if (migrations[eventName]) {
      return { action: 'retry', eventName: migrations[eventName] }
    }
    
    // Environment-specific handling
    return import.meta.env.DEV 
      ? { action: 'continue' }
      : { action: 'fail', error: 'Unknown event not allowed' }
  }
})

// Schema 3: Silent ignore
export const schema3 = makeSchema({ 
  events, 
  state,
  onUnknownEvent: () => ({ action: 'continue' })
})

// Schema 4: Strict mode
export const schema4 = makeSchema({ 
  events, 
  state,
  onUnknownEvent: ({ eventName }) => ({
    action: 'fail', 
    error: `Unknown event '${eventName}' not allowed`
  })
})
```

## Key Design Decisions

### ✅ **Synchronous Only**
- No async/Promise/Effect support
- Keeps event processing fast and deterministic
- Simpler error handling and testing

### ✅ **Default Warning Behavior**
- No callback = logs warning and continues
- Safe default that provides visibility
- User callback disables default logging

### ✅ **Single Callback Approach**
- One concept instead of multiple strategies
- Full user control over behavior
- Easy to combine logging, metrics, migration logic

## Callback Interface

```typescript
interface UnknownEventContext {
  eventName: string
  eventData: unknown  
  availableEvents: ReadonlyArray<string>
}

type UnknownEventResult = 
  | { action: 'continue' }                    // Skip event, proceed
  | { action: 'fail', error?: string }        // Stop processing with error
```

**Note**: Event migration/aliasing is handled through schema evolution and replay mechanisms, not runtime retry actions.

## Demo Component

The demo shows five different approaches:

1. **Default**: Warning logging (schema1)
2. **Environment-Specific**: Development vs production behavior (schema2)  
3. **Silent**: Ignore unknown events (schema3)
4. **Strict**: Fail on any unknown event (schema4)
5. **Custom**: Custom logging + metrics (schema5)

## Real-World Use Cases

### Schema Evolution Tracking
```typescript
onUnknownEvent: ({ eventName, eventData }) => {
  // Track unknown events for future schema evolution
  storeUnknownEvent(eventName, eventData)
  
  // Log for debugging
  console.warn(`Unknown event '${eventName}' from newer client version`)
  
  return { action: 'continue' }
}
```

### Development vs Production
```typescript
onUnknownEvent: ({ eventName }) => {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`Unknown event: ${eventName}`)
    return { action: 'continue' }
  }
  return { action: 'fail', error: `Unknown event: ${eventName}` }
}
```

### Custom Logging + Metrics
```typescript
onUnknownEvent: ({ eventName, eventData }) => {
  // Custom structured logging
  logger.warn('Unknown event encountered', { eventName, eventData })
  
  // Send to analytics
  analytics.track('unknown_event', { eventName })
  
  return { action: 'continue' }
}
```

This simplified synchronous API provides maximum control while being easy to understand and implement.