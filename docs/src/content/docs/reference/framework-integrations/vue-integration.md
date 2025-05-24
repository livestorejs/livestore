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

## Usage with ...

### Vite

LiveStore and vue-livestore works with Vite out of the box.

### Nuxt.js

Should work with Nuxt out of the box if SSR is disabled. It's on the road-map to figure out best way to approach integration. A good starting point for reference would be to look at [hello-zero-nuxt](https://github.com/danielroe/hello-zero-nuxt).

## Technical notes

- Vue-livestore uses the provider component pattern similar to the React integration. In Vue the plugin pattern is more common but it isn't clear that that's the most suitable structure for LiveStore in Vue. We might switch to the plugin pattern if we later find that more suitable especially with regards to Nuxt support and supporting multiple stores.