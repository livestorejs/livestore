<script setup lang="ts">
import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import LiveStoreWorker from './livestore/livestore.worker.ts?worker'
import { schema } from './livestore/schema.ts'

const adapter = makePersistedAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

const storeOptions = {
  schema,
  adapter,
  storeId: 'test_store',
}

void storeOptions
</script>

<template>
  <LiveStoreProvider :options="storeOptions">
    <template #loading>
      <div>Loading LiveStore...</div>
    </template>
    <slot />
  </LiveStoreProvider>
</template>
