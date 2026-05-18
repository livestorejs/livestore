<script setup lang="ts">
import { useClientDocument } from 'vue-livestore'

import { tables } from './schema.ts'

// biome-ignore lint/correctness/useHookAtTopLevel: Vue composables run at script setup level
const { newTodoText, filter } = useClientDocument(tables.uiState)

void newTodoText
void filter

void newTodoText
void filter
</script>

<template>
  <div>
    <input type="text" v-model="newTodoText" />

    <select v-model="filter">
      <option value="all">All</option>
      <option value="active">Active</option>
      <option value="completed">Completed</option>
    </select>
  </div>
</template>
