/**
 * Client sequence numbers track events created locally before sync confirmation.
 * Also contains the Composite type combining global and client sequence numbers with a rebase
 * generation to fully identify an event's position in the eventlog.
 *
 * For event notation documentation, see: contributor-docs/events-notation.md
 *
 * @example
 * ```ts
 * import { EventSequenceNumber } from '@livestore/common'
 *
 * // Client sequence number
 * const clientSeq = EventSequenceNumber.Client.make(1)
 *
 * // Composite sequence number
 * const composite: EventSequenceNumber.Client.Composite = {
 *   global: EventSequenceNumber.Global.make(5),
 *   client: EventSequenceNumber.Client.DEFAULT,
 *   rebaseGeneration: 0,
 * }
 * ```
 */
export * as Client from './client.ts'

/**
 * Global sequence numbers are assigned by the sync backend and represent
 * the canonical ordering of events across all clients. They are monotonically
 * increasing integers that establish the authoritative event timeline.
 *
 * @example
 * ```ts
 * import { EventSequenceNumber } from '@livestore/common'
 *
 * const globalSeq = EventSequenceNumber.Global.make(5)
 * ```
 */
export * as Global from './global.ts'
