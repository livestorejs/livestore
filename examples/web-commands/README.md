# Commands API Example

This example demonstrates the LiveStore **Commands API** using a TodoMVC application.

## Commands vs Direct Events

The original TodoMVC example uses direct event commits:

```typescript
store.commit(events.todoCreated({ id, text }))
```

This example uses commands with validation:

```typescript
const result = store.execute(commands.createTodo({ text }))
if (result._tag === 'failed') {
  console.error(result.error.message)
}
```

## Key Features

- **Validation**: Commands validate input before committing events (e.g., empty todo text is rejected)
- **State Queries**: Command handlers can query current state to validate preconditions
- **Sync-Safe**: Commands are re-evaluated during sync reconciliation to detect conflicts

## Commands in this Example

| Command | Validation |
|---------|-----------|
| `createTodo` | Text must not be empty |
| `toggleTodo` | Todo must exist and not be deleted |
| `deleteTodo` | Todo must exist and not already be deleted |
| `clearCompleted` | At least one completed todo must exist |

## Running locally

```bash
pnpm install
pnpm --filter examples/web-commands dev
```

The Cloudflare Vite plugin starts both the React front-end and the Durable Object
sync backend on the same dev server port.
