<script setup lang="ts">
import { makeInMemoryAdapter } from '@livestore/adapter-web'

import { schema } from './schema.ts'

const adapter = makeInMemoryAdapter()
const storeId = 'demo-store'
const _options = { schema, adapter, storeId }
</script>

<template>
  <LiveStoreProvider :options="options">
    <template #loading>
      <div>Loading LiveStore...</div>
    </template>
    <slot />
  </LiveStoreProvider>
</template>
