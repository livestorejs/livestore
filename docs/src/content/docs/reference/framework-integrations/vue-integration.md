---
title: Vue integration for LiveStore
sidebar:
  label: Vue
description: How to integrate LiveStore with Vue.
---

The [vue-livestore](https://github.com/slashv/vue-livestore) package provides integration with Vue. It's currently in beta but aims to match feature parity with the React integration.

## API

### `LiveStoreProvider`

In order to use LiveStore with Vue, you need to wrap your application in a `LiveStoreProvider`.

```vue
<script setup lang="ts">
import { LiveStoreProvider } from 'vue-livestore'
</script>

<template>
  <LiveStoreProvider :options="{ schema, adapter, storeId }">
    <template #loading>
      <div>Loading LiveStore...</div>
    </template>
    <ToDos />
  </LiveStoreProvider>
</template>
```

### useStore

```ts
const { store } = useStore()

const createTodo = () => {
  store.commit(
    events.todoCreated({ id: crypto.randomUUID(), text: 'Eat broccoli' })
  )
}
```

### useQuery

```vue
<script setup lang="ts">
import { queryDb } from '@livestore/livestore'
import { useQuery } from 'vue-livestore'
import { events, tables } from '../livestore/schema'

const visibleTodos$ = queryDb(
  () => tables.todos.where({ deletedAt: null }),
  { label: 'visibleTodos' },
)

const todos = useQuery(visibleTodos$)
</script>

<template>
  <div>
    <ul>
      <li v-for="todo in todos" :key="todo.id">
        {{ todo.text }}
      </li>
    </ul>
  </div>
</template>
```

### useClientDocument

**[!] The interface for useClientDocument is experimental and might change**

Since it's more common in Vue to work with a single writable ref (as compared to state, setState in React) the useClientDocument composable for Vue tries to make that easier by directly returning a collection of refs.

The current implementation destructures all client state variables into the return object which allows directly binding to v-model or editing the .value reactivly.

```vue
<script setup lang="ts">
import { tables } from '../livestore/schema'

const { newTodoText, filters } = useClientDocument(tables.uiState)
</script>

<template>
<input type="text" v-model="newTodoText">

<select v-model="filters">
  <option value="all">All</option>
  ...
<select>
</template>
```

## Usage with ...

### Vite

LiveStore and vue-livestore works with Vite out of the box.

### Nuxt.js

Works out of the box with Nuxt if SSR is disabled by just wrapping the main content in a LiveStoreProvider. Example repo upcoming.

## Technical notes

- Vue-livestore uses the provider component pattern similar to the React integration. In Vue the plugin pattern is more common but it isn't clear that that's the most suitable structure for LiveStore in Vue. We might switch to the plugin pattern if we later find that more suitable especially with regards to Nuxt support and supporting multiple stores.