import type { Store } from '@livestore/livestore'

import { storeEvents } from './schema.ts'

declare const store: Store

store.commit(storeEvents.todoCreated({ id: '1', text: 'Buy milk' }))
