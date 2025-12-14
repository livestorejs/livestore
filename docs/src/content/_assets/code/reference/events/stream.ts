import type { Store } from '@livestore/livestore'

declare const store: Store

for await (const event of store.events()) {
  console.log('event from leader', event)
}
