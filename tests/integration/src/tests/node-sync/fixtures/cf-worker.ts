import { makeDurableObject, makeWorker } from '@livestore/sync-cf/cf-worker'

export class WebSocketServer extends makeDurableObject({
  // onPush: async (message) => {
  //   console.log('cf-worker:onPush', message)
  // },
  // onPull: async (message) => {
  //   console.log('cf-worker:onPull', message)
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
