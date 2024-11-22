import { queryDb, SessionIdSymbol } from '@livestore/livestore'

import { tables } from './schema.js'

export const app$ = queryDb(tables.app.query.row(SessionIdSymbol), { label: 'app' })
