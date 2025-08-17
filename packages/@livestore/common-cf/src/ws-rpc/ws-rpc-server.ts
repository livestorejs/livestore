import {
  constVoid,
  Effect,
  Layer,
  Mailbox,
  RpcMessage,
  RpcSerialization,
  RpcServer,
  Stream,
} from '@livestore/utils/effect'

export type WsRpcServerArgs = {
  send: (msg: Uint8Array<ArrayBufferLike> | string) => Effect.Effect<void>
  incomingQueue: Mailbox.Mailbox<Uint8Array<ArrayBufferLike> | string>
}

export const layerRpcServerWebsocket = (args: WsRpcServerArgs) =>
  Layer.scoped(RpcServer.Protocol, makeSocketProtocol(args))

const makeSocketProtocol = ({ incomingQueue, send: writeRaw }: WsRpcServerArgs) =>
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization
    const disconnects = yield* Mailbox.make<number>()

    let writeRequest!: (clientId: number, message: RpcMessage.FromClientEncoded) => Effect.Effect<void>

    const parser = serialization.unsafeMake()
    const id = 0

    const write = (response: RpcMessage.FromServerEncoded) => {
      try {
        const encoded = parser.encode(response)
        if (encoded === undefined) {
          return Effect.void
        }
        return Effect.orDie(writeRaw(encoded))
      } catch (cause) {
        return Effect.orDie(writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!))
      }
    }

    const protocol = yield* RpcServer.Protocol.make((writeRequest_) => {
      writeRequest = writeRequest_

      // Start processing messages now that writeRequest is available
      const startProcessing = Mailbox.toStream(incomingQueue).pipe(
        Stream.tap((data) => {
          try {
            const decoded = parser.decode(data) as ReadonlyArray<RpcMessage.FromClientEncoded>
            if (decoded.length === 0) return Effect.void
            let i = 0
            return Effect.whileLoop({
              while: () => i < decoded.length,
              body: () => writeRequest(id, decoded[i++]!),
              step: constVoid,
            })
          } catch (cause) {
            return Effect.orDie(writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!))
          }
        }),
        Stream.runDrain,
        Effect.tapCauseLogPretty,
        Effect.fork,
      )

      // Start the message processing
      return Effect.map(startProcessing, () => ({
        disconnects,
        send: (_clientId, response) => Effect.orDie(write(response)),
        end(_clientId) {
          return Effect.void
        },
        clientIds: Effect.sync(() => [id]),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
      }))
    })

    return protocol
  })
