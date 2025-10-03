<script setup lang="ts">
/// <reference path="./vue-livestore.d.ts" />
import { queryDb } from '@livestore/livestore'
import { useQuery } from 'vue-livestore'

import { tables } from './schema.ts'

const visibleTodos$ = queryDb(() => tables.todos.where({ completed: false }), { label: 'visibleTodos' })

// biome-ignore lint/correctness/useHookAtTopLevel: Vue composables run at script setup level
const todos = useQuery(visibleTodos$)

void todos
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
