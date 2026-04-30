export const gettingStartedContent = `# Getting Started with LiveStore

Build your first local-first application with LiveStore in minutes. This guide walks through creating a real-time collaborative todo app that works offline and syncs when online.

## Quick Start

### 1. Installation

\`\`\`bash
# Install LiveStore core
npm install @livestore/livestore

# Choose your platform adapter
npm install @livestore/adapter-web      # For web applications
npm install @livestore/adapter-node     # For Node.js applications
npm install @livestore/adapter-expo     # For React Native/Expo apps
\`\`\`

### 2. Define Your Schema

LiveStore uses an event-driven architecture where all changes are recorded as immutable events and applied to materialized SQLite tables.

\`\`\`typescript
// schema.ts
import { Events, makeSchema, Schema, SessionIdSymbol, State } from '@livestore/livestore'

// Define your state as SQLite tables
export const tables = {
  todos: State.SQLite.table({
    name: 'todos',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text({ default: '' }),
      completed: State.SQLite.boolean({ default: false }),
      deletedAt: State.SQLite.integer({ nullable: true, schema: Schema.DateFromNumber }),
      createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    },
  }),
  
  // Client-only state (not synced)
  uiState: State.SQLite.clientDocument({
    name: 'uiState',
    schema: Schema.Struct({ 
      newTodoText: Schema.String, 
      filter: Schema.Literal('all', 'active', 'completed') 
    }),
    default: { id: SessionIdSymbol, value: { newTodoText: '', filter: 'all' } },
  }),
}

// Define events that represent state changes
export const events = {
  todoCreated: Events.synced({
    name: 'v1.TodoCreated',
    schema: Schema.Struct({ 
      id: Schema.String, 
      text: Schema.String,
      createdAt: Schema.Date 
    }),
  }),
  todoCompleted: Events.synced({
    name: 'v1.TodoCompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoUncompleted: Events.synced({
    name: 'v1.TodoUncompleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  todoDeleted: Events.synced({
    name: 'v1.TodoDeleted',
    schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
  }),
  
  // UI state events (local only)
  uiStateSet: tables.uiState.set,
}

// Materializers map events to state changes
const materializers = State.SQLite.materializers(events, {
  'v1.TodoCreated': ({ id, text, createdAt }) => 
    tables.todos.insert({ id, text, completed: false, createdAt }),
    
  'v1.TodoCompleted': ({ id }) => 
    tables.todos.update({ completed: true }).where({ id }),
    
  'v1.TodoUncompleted': ({ id }) => 
    tables.todos.update({ completed: false }).where({ id }),
    
  'v1.TodoDeleted': ({ id, deletedAt }) => 
    tables.todos.update({ deletedAt }).where({ id }),
})

const state = State.SQLite.makeState({ tables, materializers })

export const schema = makeSchema({ events, state })
\`\`\`

### 3. Create Reactive Queries

LiveStore queries automatically update your UI when underlying data changes.

\`\`\`typescript
// queries.ts
import { queryDb } from '@livestore/livestore'
import { tables } from './schema.js'

// Reactive query for all active todos
export const activeTodos$ = queryDb(
  tables.todos
    .select()
    .where({ deletedAt: null, completed: false })
    .orderBy('createdAt'),
  { label: 'activeTodos' }
)

// Reactive query for completed todos
export const completedTodos$ = queryDb(
  tables.todos
    .select()
    .where({ deletedAt: null, completed: true })
    .orderBy('createdAt'),
  { label: 'completedTodos' }
)

// UI state query
export const uiState$ = queryDb(
  tables.uiState.get(),
  { label: 'uiState' }
)
\`\`\`

### 4. Connect to Your UI Framework

#### React Integration

\`\`\`typescript
// TodoApp.tsx
import React from 'react'
import { useLiveQuery, dispatchEvent } from '@livestore/react'
import { activeTodos$, completedTodos$, uiState$ } from './queries.js'
import { events } from './schema.js'

const TodoApp: React.FC = () => {
  const activeTodos = useLiveQuery(activeTodos$)
  const completedTodos = useLiveQuery(completedTodos$)
  const uiState = useLiveQuery(uiState$)
  
  const createTodo = (text: string) => {
    const id = crypto.randomUUID()
    dispatchEvent(events.todoCreated({ id, text, createdAt: new Date() }))
  }
  
  const toggleTodo = (id: string, completed: boolean) => {
    dispatchEvent(
      completed 
        ? events.todoCompleted({ id })
        : events.todoUncompleted({ id })
    )
  }
  
  const deleteTodo = (id: string) => {
    dispatchEvent(events.todoDeleted({ id, deletedAt: new Date() }))
  }
  
  return (
    <div className="todo-app">
      <h1>Local-First Todos</h1>
      
      {/* Add todo form */}
      <form onSubmit={(e) => {
        e.preventDefault()
        const form = e.target as HTMLFormElement
        const input = form.elements.namedItem('todo') as HTMLInputElement
        if (input.value.trim()) {
          createTodo(input.value.trim())
          input.value = ''
        }
      }}>
        <input name="todo" placeholder="What needs to be done?" />
        <button type="submit">Add Todo</button>
      </form>
      
      {/* Active todos */}
      <div className="todo-list">
        <h2>Active ({activeTodos.length})</h2>
        {activeTodos.map(todo => (
          <div key={todo.id} className="todo-item">
            <input 
              type="checkbox"
              checked={false}
              onChange={() => toggleTodo(todo.id, true)}
            />
            <span>{todo.text}</span>
            <button onClick={() => deleteTodo(todo.id)}>Delete</button>
          </div>
        ))}
      </div>
      
      {/* Completed todos */}
      <div className="todo-list">
        <h2>Completed ({completedTodos.length})</h2>
        {completedTodos.map(todo => (
          <div key={todo.id} className="todo-item completed">
            <input 
              type="checkbox"
              checked={true}
              onChange={() => toggleTodo(todo.id, false)}
            />
            <span>{todo.text}</span>
            <button onClick={() => deleteTodo(todo.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default TodoApp
\`\`\`

#### Vue Integration

\`\`\`vue
<!-- TodoApp.vue -->
<template>
  <div class="todo-app">
    <h1>Local-First Todos</h1>
    
    <form @submit.prevent="createTodo">
      <input v-model="newTodoText" placeholder="What needs to be done?" />
      <button type="submit">Add Todo</button>
    </form>
    
    <div class="todo-list">
      <h2>Active ({{ activeTodos.length }})</h2>
      <div v-for="todo in activeTodos" :key="todo.id" class="todo-item">
        <input 
          type="checkbox"
          :checked="false"
          @change="toggleTodo(todo.id, true)"
        />
        <span>{{ todo.text }}</span>
        <button @click="deleteTodo(todo.id)">Delete</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useLiveQuery, dispatchEvent } from '@livestore/vue'
import { activeTodos$ } from './queries.js'
import { events } from './schema.js'

const activeTodos = useLiveQuery(activeTodos$)
const newTodoText = ref('')

const createTodo = () => {
  if (newTodoText.value.trim()) {
    const id = crypto.randomUUID()
    dispatchEvent(events.todoCreated({ 
      id, 
      text: newTodoText.value.trim(), 
      createdAt: new Date() 
    }))
    newTodoText.value = ''
  }
}

const toggleTodo = (id: string, completed: boolean) => {
  dispatchEvent(
    completed 
      ? events.todoCompleted({ id })
      : events.todoUncompleted({ id })
  )
}

const deleteTodo = (id: string) => {
  dispatchEvent(events.todoDeleted({ id, deletedAt: new Date() }))
}
</script>
\`\`\`

### 5. Initialize Your Application

\`\`\`typescript
// main.ts
import { LiveStore } from '@livestore/livestore'
import { WebAdapter } from '@livestore/adapter-web'
import { schema } from './schema.js'

// Initialize LiveStore with your schema
const liveStore = LiveStore.create({
  schema,
  adapter: WebAdapter({
    databaseName: 'todo-app',
    // Optional: Add sync configuration
    sync: {
      url: 'wss://your-sync-server.com',
      auth: { token: 'your-auth-token' }
    }
  })
})

// Start your application
const app = document.getElementById('app')
if (app) {
  // Your framework-specific initialization
  // React: createRoot(app).render(<TodoApp />)
  // Vue: createApp(TodoApp).mount(app)
}
\`\`\`

## Advanced Features

### Offline Support

Your app automatically works offline. All operations execute against the local database, and changes sync when connectivity returns.

\`\`\`typescript
// Check online status
const isOnline$ = queryDb(
  LiveStore.connectionStatus(),
  { label: 'connectionStatus' }
)
\`\`\`

### Real-Time Collaboration

Multiple users can collaborate in real-time. Conflicts are automatically resolved using last-write-wins or custom merge strategies.

\`\`\`typescript
// Custom conflict resolution
const materializers = State.SQLite.materializers(events, {
  'v1.TodoTextChanged': ({ id, text, editedAt }) => 
    // Use timestamp for conflict resolution
    tables.todos
      .update({ text, editedAt })
      .where({ id })
      .and(tables.todos.column('editedAt').lt(editedAt))
})
\`\`\`

### Testing

\`\`\`typescript
// todo.test.ts
import { createTestStore } from '@livestore/testing'
import { schema, events } from './schema.js'

test('creating and completing todos', async () => {
  const store = createTestStore(schema)
  
  // Dispatch events
  await store.dispatch([
    events.todoCreated({ id: '1', text: 'Test todo', createdAt: new Date() }),
    events.todoCompleted({ id: '1' })
  ])
  
  // Query final state
  const completedTodos = await store.query(
    tables.todos.select().where({ completed: true })
  )
  
  expect(completedTodos).toHaveLength(1)
  expect(completedTodos[0].text).toBe('Test todo')
})
\`\`\`

## Next Steps

### Production Deployment
1. **Set up sync server**: Deploy LiveStore sync server for real-time collaboration
2. **Configure authentication**: Add user authentication and authorization
3. **Add monitoring**: Set up distributed tracing and performance monitoring
4. **Optimize performance**: Add indexes and query optimization

### Advanced Patterns
- **Multi-user collaboration**: User permissions and access control
- **Rich text editing**: Operational transforms for collaborative editing
- **File synchronization**: Binary data and file attachment handling
- **Schema migrations**: Evolving your data model over time

### Platform-Specific Guides
- **Web deployment**: Service workers, PWA configuration, OPFS optimization
- **Mobile apps**: Background sync, push notifications, native storage
- **Desktop apps**: Electron integration, native file system access

## Examples Repository

Explore complete working examples:
- **TodoMVC**: Classic todo app with real-time sync
- **Collaborative Editor**: Rich text editing with operational transforms
- **Chat Application**: Real-time messaging with presence indicators
- **E-commerce**: Product catalog with shopping cart and orders

\`\`\`bash
# Clone examples repository
git clone https://github.com/livestorejs/examples.git
cd examples/web-todomvc
npm install && npm run dev
\`\`\`

Visit [docs.livestore.dev](https://docs.livestore.dev) for comprehensive documentation, API reference, and advanced patterns.`
