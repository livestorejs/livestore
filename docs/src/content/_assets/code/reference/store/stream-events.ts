import type { Store } from '@livestore/livestore'

declare const store: Store

// Run once
for await (const event of store.events()) {
  console.log('event from leader', event)
}

// Continuos stream
const iterator = store.events()[Symbol.asyncIterator]()
try {
  while (true) {
    const { value, done } = await iterator.next()
    if (done) break
    console.log('event from stream:', value)
  }
} finally {
  await iterator.return?.()
}