import type {
  BootStatus,
  ConnectDevtoolsToStore,
  Coordinator,
  IntentionalShutdownCause,
  UnexpectedError,
} from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type { Cause, Effect, Queue, Scope } from '@livestore/utils/effect'

import type { SqliteWasm } from '../sqlite-utils.js'

export type MakeCoordinator = (props: {
  schema: LiveStoreSchema
  sqlite3: SqliteWasm.Sqlite3Static
  devtoolsEnabled: boolean
  bootStatusQueue: Queue.Queue<BootStatus>
  shutdown: (cause: Cause.Cause<IntentionalShutdownCause | UnexpectedError>) => Effect.Effect<void>
  connectDevtoolsToStore: ConnectDevtoolsToStore
}) => Effect.Effect<Coordinator, UnexpectedError, Scope.Scope>
