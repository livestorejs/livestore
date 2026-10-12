import { expect, it } from 'vitest'

import { IsOfflineError, UnknownError } from '@livestore/common'
import { HttpClientError, RpcClientError, Socket } from '@livestore/utils/effect'

import { mapRpcClientError } from './rpc-client-error.ts'

const socketReasons = [
  new Socket.SocketCloseError({ code: 1012, closeReason: 'Restart' }),
  new Socket.SocketReadError({ cause: new Error('Disconnected') }),
  new Socket.SocketWriteError({ cause: new Error('Disconnected') }),
  new Socket.SocketOpenError({ kind: 'Timeout', cause: new Error('Unavailable') }),
  new Socket.SocketUpgradeError({ cause: new Error('Upgrade failed') }),
]

it.each(socketReasons)('maps $\u005ftag to offline', (reason) => {
  const result = mapRpcClientError(new RpcClientError.RpcClientError({ reason }))
  expect(result).toBeInstanceOf(IsOfflineError)
  expect(result.cause).toBe(reason)
})

it('maps an HTTP transport failure to offline', () => {
  const reason = new HttpClientError.HttpClientErrorSchema({ kind: 'TransportError' })
  const result = mapRpcClientError(new RpcClientError.RpcClientError({ reason }))
  expect(result).toBeInstanceOf(IsOfflineError)
  expect(result.cause).toBe(reason)
})

const protocolReasons = [
  new RpcClientError.RpcClientDefect({ message: 'Malformed RPC response', cause: new Error('Invalid message') }),
  ...(['EncodeError', 'DecodeError', 'InvalidUrlError', 'StatusCodeError', 'EmptyBodyError'] as const).map(
    (kind) => new HttpClientError.HttpClientErrorSchema({ kind }),
  ),
]

it.each(protocolReasons)('keeps protocol failure $\u005ftag terminal', (reason) => {
  const error = new RpcClientError.RpcClientError({ reason })
  const result = mapRpcClientError(error)
  expect(result).toBeInstanceOf(UnknownError)
  expect(result.cause).toBe(error)
})
