import { ParseResult, WorkerError } from '@livestore/utils/effect'

/**
 * Type guard that identifies infrastructure errors from the Effect Worker transport layer.
 *
 * @remarks
 *
 * These errors ({@link WorkerError.WorkerError}, {@link ParseResult.ParseError}) represent communication failures between
 * threads/processes — not application-level failures.
 */
export const isWorkerTransportError = (e: unknown): e is WorkerError.WorkerError | ParseResult.ParseError =>
  ParseResult.isParseError(e) || WorkerError.isWorkerError(e)
