import { DbSchema as __DbSchema } from '@livestore/livestore'
import { useRow } from '@livestore/livestore/react'

import { tables } from './schema.js'

export const useAppState = () => useRow(tables.app)[0]
