import type { Coordinator, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Effect } from '@livestore/utils/effect'

import type { SqliteWasm } from '../sqlite-utils.js'

export type MakeCoordinator = (props: {
  schema: LiveStoreSchema
  sqlite3: SqliteWasm.Sqlite3Static
  devtoolsEnabled: boolean
}) => Effect.Effect<Coordinator, UnexpectedError, never>
