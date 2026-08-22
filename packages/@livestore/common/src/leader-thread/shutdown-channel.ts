import { type Effect, type WebChannel, Schema } from '@livestore/utils/effect'

import {
  BackendIdMismatchError,
  IntentionalShutdownCause,
  MaterializeError,
  PoisonedEventError,
  UnknownError,
} from '../index.ts'

export const All = Schema.Union([
  IntentionalShutdownCause,
  UnknownError,
  BackendIdMismatchError,
  MaterializeError,
  PoisonedEventError,
])

/**
 * Used internally by an adapter to shutdown gracefully.
 */
export type ShutdownChannel = WebChannel.WebChannel<typeof All.Type, typeof All.Type>

/** Delivers a fatal sync condition to the owning Store lifecycle in the current topology. */
export type LifecycleShutdown = (cause: typeof All.Type) => Effect.Effect<void, Schema.SchemaError>
