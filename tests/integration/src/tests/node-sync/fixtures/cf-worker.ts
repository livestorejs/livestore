import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'

export class WebSocketServer extends makeDurableObject({
  // onPush: async (message, context) => {
  //   console.log('cf-worker:onPush', message, 'storeId:', context.storeId, 'payload:', context.payload)
  // },
  // onPull: async (message, context) => {
  //   console.log('cf-worker:onPull', message, 'storeId:', context.storeId, 'payload:', context.payload)
  // },
  // onPushRes: async (message) => {
  //   console.log('cf-worker:onPushRes', message._tag)
  // },
  // onPullRes: async (message) => {
  //   if (message._tag === 'WSMessage.PullRes') {
  //     console.log('cf-worker:onPullRes', message.requestId, message.remaining, message.batch)
  //   } else {
  //     console.log('cf-worker:onPullRes', message)
  //   }
  // },
}) {}

export default makeWorker()
