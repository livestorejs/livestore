import type { BootStatus, Coordinator, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Effect, Queue } from '@livestore/utils/effect'

import type { SqliteWasm } from '../sqlite-utils.js'

export type MakeCoordinator = (props: {
  schema: LiveStoreSchema
  sqlite3: SqliteWasm.Sqlite3Static
  devtoolsEnabled: boolean
  bootStatusQueue: Queue.Queue<BootStatus>
}) => Effect.Effect<Coordinator, UnexpectedError, never>
