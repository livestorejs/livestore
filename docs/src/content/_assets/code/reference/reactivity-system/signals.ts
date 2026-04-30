import { type Store, signal } from '@livestore/livestore'

import type { schema } from '../framework-integrations/react/schema.ts'

declare const store: Store<typeof schema>

const now$ = signal(Date.now(), { label: 'now$' })

setInterval(() => {
  store.setSignal(now$, Date.now())
}, 1000)

const num$ = signal(0, { label: 'num$' })
const increment = () => store.setSignal(num$, (prev) => prev + 1)

increment()
increment()

console.log(store.query(num$))
