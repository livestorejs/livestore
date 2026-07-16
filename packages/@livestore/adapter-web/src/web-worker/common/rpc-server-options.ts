/**
 * Worker handlers share a trusted, same-origin boundary with their clients. Keeping handler defects request-scoped
 * lets RPC encode the complete `Cause` (including mixed typed failures and defects) instead of broadcasting one
 * squashed defect and cancelling every in-flight request on the connection.
 *
 * Protocol and decoding failures remain protocol failures; this only changes how completed handler causes are sent.
 */
export const requestScopedCauseRpcServerOptions = {
  disableFatalDefects: true,
} as const
