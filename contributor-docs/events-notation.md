# Event Notation Guide

Concise notation for describing event sequences in Livestore.

## Core Concepts

### Event Sequence Numbers

Events use integer sequence numbers and are denoted as `e0`, `e1`, `e2`, etc. These correspond to the `EventSequenceNumber` type (see `packages/@livestore/common/src/schema/EventSequenceNumber.ts`) which contains:
- **global**: Globally unique integer sequence number
- **client**: Client-local event counter (default: 0)
- **rebaseGeneration**: Increments when client rebases (default: 0)

### Notation Format

```
[Client:]e{global}[.{client}][r{rebaseGeneration}]['][/{origin}][{context}]
```

The base format `e{global}[.{client}][r{rebaseGeneration}]` is implemented by `EventSequenceNumber.toString()` and `EventSequenceNumber.fromString()`.

Core examples:
- `e0` - Global event 0
- `e3'` - Unconfirmed event 3
- `e5.1` - Client-local event (global: 5, client: 1)
- `e3r1` - Event with rebase generation 1

Extended examples:
- `A:e3'` - Client A's unconfirmed e3
- `e3{userCreated}` - Event with context hint
- `B:e5'/e3'` - Client B's e5' that was originally e3'
- `B:e5.1'{user.456}/e3'` - Full notation with client, context, and origin

### Client-Local Events

Events with non-zero client numbers (`e5.1`, `e5.2`, `e5.3`, etc.) are client-local and won't sync to the backend. They increment the client counter while keeping the same global number.

```
e5 → e5.1 → e5.2 → e5.3 → e6
     └─ client-local ─┘
```

## Common Patterns

### Sequential Events
```
e1 → e2 → e3
```

The arrow notation (`→`) shows chronological order, with parent relationships pointing backward: e3's parent is e2, e2's parent is e1.

## Sync Scenarios

### Unconfirmed Events

Events that haven't been confirmed by the sync backend are denoted with a single quote:
- `e3'` - Unconfirmed event (pending confirmation from sync backend)

### Notation for Client-Specific Unconfirmed Events

When multiple clients create unconfirmed events independently, we use prefix notation to distinguish them:
- `A:e3'` - Client A's unconfirmed e3
- `B:e3'` - Client B's unconfirmed e3

### Partition and Sync Example

Two clients start with shared history, partition, create local events offline, then sync:

```
Initial state (all synced):
Client A:      e1 → e2
Client B:      e1 → e2
Sync Backend:  e1 → e2

Network partition occurs:
════════════════════════════════════════════════

Offline activity (both clients number from e3):
Client A:      e1 → e2 → A:e3' → A:e4'
Client B:      e1 → e2 → B:e3' → B:e4' → B:e5'
Sync Backend:  e1 → e2 (unchanged)

Network restored, sync begins:
────────────────────────────────────────────────

Client A syncs first:
Client A:      e1 → e2 → e3 → e4  (confirmed)
Sync Backend:  e1 → e2 → e3 → e4

Client B syncs (rebase required):
Client B before:   e1 → e2 → B:e3' → B:e4' → B:e5'
Client B rebased:  e1 → e2 → e3 → e4 → B:e5'/e3' → B:e6'/e4' → B:e7'/e5'  (unconfirmed)
Client B after:    e1 → e2 → e3 → e4 → e5 → e6 → e7  (confirmed)
Sync Backend:      e1 → e2 → e3 → e4 → e5 → e6 → e7

Final state (all synced):
Client A:      e1 → e2 → e3 → e4 → e5 → e6 → e7  (after pull)
Client B:      e1 → e2 → e3 → e4 → e5 → e6 → e7
Sync Backend:  e1 → e2 → e3 → e4 → e5 → e6 → e7
```

Notes:
- Each client independently numbers their unconfirmed events starting from e3'
- The prefix `A:` or `B:` clarifies which client created each unconfirmed event
- The sync backend assigns the final authoritative sequence numbers
- Rebasing happens in two steps: first events are rebased locally (still unconfirmed), then confirmed by the sync backend
- The `/e3'` notation shows the origin: `B:e5'/e3'` means B's e5' was originally e3'

### Multiple Rebases Example

When a client undergoes multiple rebases, the origin tracks through each rebase:

```
Initial:       C:e3'
First rebase:  C:e5'/e3'   (rebased from sequence number 3 to 5)
Second rebase: C:e8'/e5'/e3'  (rebased from sequence number 5 to 8)
Final:         e8  (confirmed)
```

The notation `C:e8'/e5'/e3'` shows the complete rebase history: originally e3', became e5' after first rebase, then e8' after second rebase.

## Event Context Hints

Add context hints to clarify what events do:

```
Client A: e1 → e2{userCreated} → e3'{userNameUpdated} → e4'{postDeleted.123}
Client B: e1 → e2 → e3'{user.456} → e4'{postCreated}

Client B rebased: e1 → e2 → e3 → e4 → B:e5'{user.456}/e3' → B:e6'{postCreated}/e4'
```

Context hint formats:
- `{eventName}` - Event name: `e2{userCreated}`
- `{entity.eventName}` - Entity and event: `e3'{user.updated}`
- `{entity.id}` - Specific entity: `e4'{user.123}`
- `{entity.id.field}` - Specific field: `e5'{user.123.email}`

## Usage in Code

```typescript
// Test scenario: e1 arrives before e2 but has later timestamp
// Expected order: e2 → e1
```