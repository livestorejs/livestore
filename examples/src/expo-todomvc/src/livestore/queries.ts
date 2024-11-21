import { queryDb } from '@livestore/livestore'

import { tables } from './schema.ts'

export const app$ = queryDb(tables.app.query.row(), { label: 'app' })
