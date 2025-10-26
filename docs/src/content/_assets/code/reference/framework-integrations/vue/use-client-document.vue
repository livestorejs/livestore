<script setup lang="ts">
/// <reference path="./vue-livestore.d.ts" />
import { useClientDocument } from 'vue-livestore'

import { tables } from './schema.ts'

// biome-ignore lint/correctness/useHookAtTopLevel: Vue composables run at script setup level
const { text: newTodoText, filters } = useClientDocument(tables.uiState)

void newTodoText
void filters

void newTodoText
void filters
</script>

<template>
  <div>
    <input type="text" v-model="newTodoText" />

    <select v-model="filters">
      <option value="all">All</option>
      <option value="active">Active</option>
      <option value="completed">Completed</option>
    </select>
  </div>
</template>
