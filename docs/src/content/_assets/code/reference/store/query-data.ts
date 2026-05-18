/** biome-ignore-all lint/correctness/noUnusedVariables: docs snippet shows query result */
// ---cut---
import type { Store } from '@livestore/livestore'

import { storeTables } from './schema.ts'

declare const store: Store

const todos = store.query(storeTables.todos)
console.log(todos)
