import { createWebAdapterSsrSnapshot, encodeWebAdapterSsrSnapshot } from '@livestore/adapter-web'

import { getRequestInfo } from 'rwsdk/worker'
import { schema } from '../todomvc/livestore/schema.js'
import { TodoApp } from '../todomvc/TodoApp.js'

export const Home = async () => {
  const requestInfo = getRequestInfo()

  if (requestInfo.rw.ssr) {
    try {
      const snapshot = await createWebAdapterSsrSnapshot({ schema })
      const encodedSnapshot = encodeWebAdapterSsrSnapshot(snapshot)

      requestInfo.rw.inlineScripts.add(
        `window.__LIVESTORE_SSR__=window.__LIVESTORE_SSR__??{};window.__LIVESTORE_SSR__['${snapshot.storeId}']=${JSON.stringify(
          encodedSnapshot,
        )};`,
      )
    } catch (error) {
      console.error('[TodoMVC] Failed to prepare LiveStore SSR snapshot', error)
    }
  }

  return <TodoApp />
}
