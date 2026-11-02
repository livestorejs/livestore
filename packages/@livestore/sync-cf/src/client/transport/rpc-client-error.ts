import { IsOfflineError, UnknownError } from '@livestore/common'
import { type RpcClientError, Schema, Socket } from '@livestore/utils/effect'

/** Only transport loss is retryable. RPC defects and HTTP protocol failures stay terminal. */
export const mapRpcClientError = (error: RpcClientError.RpcClientError): IsOfflineError | UnknownError =>
  Schema.is(Socket.SocketErrorReason)(error.reason) === true ||
  (error.reason._tag === 'HttpError' && error.reason.kind === 'TransportError')
    ? new IsOfflineError({ cause: error.reason })
    : new UnknownError({ cause: error })
