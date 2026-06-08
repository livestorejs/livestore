<script setup lang="ts">
import { ref } from 'vue'
import { useStore } from 'vue-livestore'

import { events } from './livestore/schema.ts'

const { store } = useStore()

const newTodoText = ref('')

const createTodo = () => {
  store.commit(events.todoCreated({ id: crypto.randomUUID(), text: newTodoText.value }))
  newTodoText.value = ''
}

void createTodo
</script>

<template>
  <div>
    <input v-model="newTodoText" />
    <button @click="createTodo">Create</button>
  </div>
</template>
