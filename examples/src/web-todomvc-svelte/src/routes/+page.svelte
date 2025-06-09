<script lang="ts">
  import { makePersistedAdapter } from '@livestore/adapter-web'
  import LiveStoreWorker from '$lib/livestore/worker.js?worker'
  import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
  import { createStore } from '@livestore/svelte'
  import { schema } from '$lib/livestore/schema'
  import Header from '$lib/components/header.svelte'
  import MainSection from '$lib/components/main-section.svelte'
  import Footer from '$lib/components/footer.svelte'

  const adapter = makePersistedAdapter({
    storage: { type: 'opfs' },
    worker: LiveStoreWorker,
    sharedWorker: LiveStoreSharedWorker,
  })
</script>

{#await createStore({ adapter, schema, storeId: 'default' })}
  <div>Loading LiveStore...</div>
{:then store}
  <section class="todoapp">
    <Header {store} />
    <MainSection {store} />
    <Footer {store} />
  </section>
{/await}
