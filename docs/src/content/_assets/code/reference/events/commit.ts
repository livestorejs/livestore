// somewhere in your app
import type { Store } from '@livestore/livestore'

import { events } from './livestore-schema.ts'

declare const store: Store

store.commit(events.todoCreated({ id: '1', text: 'Buy milk' }))
