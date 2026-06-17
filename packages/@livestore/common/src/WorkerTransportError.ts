import { Schema, WorkerError } from '@livestore/utils/effect'

/**
 * Type guard that identifies infrastructure errors from the Effect Worker transport layer.
 *
 * @remarks
 *
 * These errors ({@link WorkerError.WorkerError}, {@link Schema.SchemaError}) represent communication failures between
 * threads/processes — not application-level failures.
 */
export const isWorkerTransportError = (e: unknown): e is WorkerError.WorkerError | Schema.SchemaError =>
  Schema.isSchemaError(e) || WorkerError.isWorkerError(e)
