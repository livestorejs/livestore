import console from 'node:console'
import fs from 'node:fs'

import { Window } from 'happy-dom'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { renderToString } from 'react-dom/server'

// import { App } from './Root.jsx'

export const runSSR = async ({
  dbUrl,
  indexHtmlUrl,
  isNetlify,
}: {
  dbUrl: URL
  indexHtmlUrl: URL
  isNetlify?: boolean
}): Promise<string> => {
  const url = 'http://localhost:60002'

  const window = new Window({
    innerWidth: 1024,
    innerHeight: 768,
    url,
  })

  // @ts-expect-error TODO
  globalThis.window = window

  const App = await import('./Root.js').then((m) => m.App)

  // const app = renderToString(<App ready={() => {}} />)

  const document = window.document

  // Needed for older Node.js versions (e.g. Netlify)
  if (Promise.withResolvers === undefined) {
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    Promise.withResolvers = function <T>() {
      let resolve: (value: T | PromiseLike<T>) => void
      let reject: (reason?: any) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve: resolve!, reject: reject! }
    }
  }

  const promise = Promise.withResolvers<void>()

  // const root = document.createElement('div')
  // root.id = 'react-app'

  // document.body.append(root)

  // const BASE_URL = new URL('../public/', import.meta.url)

  // const appData = fs.readFileSync(new URL('../public/app-123.db', import.meta.url))
  const appData = fs.readFileSync(dbUrl)

  const indexHtml = fs.readFileSync(indexHtmlUrl, 'utf8')
  // const domParser = new DOMParser()
  const parser = new window.DOMParser()
  const indexHtmlDocument = parser.parseFromString(indexHtml, 'text/html')

  // Start from passed-in index.html
  document.head.innerHTML = indexHtmlDocument.head.innerHTML
  document.body.innerHTML = indexHtmlDocument.body.innerHTML

  const root = document.getElementById('react-app')!

  // Make all asset paths lowercase (needed for Netlify 🤦)
  if (isNetlify) {
    document.querySelectorAll('link[rel="stylesheet"], script').forEach((element) => {
      if (element.getAttribute('href')) {
        element.setAttribute('href', element.getAttribute('href')!.toLowerCase())
      }
      if (element.getAttribute('src')) {
        element.setAttribute('src', element.getAttribute('src')!.toLowerCase())
      }
    })
  }

  const reactRoot = ReactDOM.createRoot(root as any as HTMLElement)
  reactRoot.render(
    React.createElement(App, {
      isServerSide: true,
      initialData: appData,
      ready: () => {
        console.log("i'm ready")
        promise.resolve()
      },
    }),
  )

  // document.body.innerHTML = `

  // 		<div id="react-app"></div>
  // 		<script type="module" src="/src/main.tsx"></script>
  // `

  document.title = 'Yolo page'

  // console.log('window.happyDOM', window.happyDOM)

  // Waits for async operations such as timers, resource loading and fetch() on the page to complete
  // Note that this may get stuck when using intervals or a timer in a loop (see IBrowserSettings for ways to mitigate this)
  await window.happyDOM.waitUntilComplete()

  // Outputs the rendered result
  // console.log(window.document.documentElement.outerHTML);

  await promise.promise

  const html = `<!DOCTYPE html>
${window.document.documentElement.outerHTML}
  `

  // Cancels all ongoing operations and destroys the Window instance
  await window.happyDOM.close()

  // @ts-expect-error TODO
  globalThis.window = undefined

  reactRoot.unmount()

  return html
}

// console.log(await doSSR())

// console.log('i\'m done')
if (import.meta.main) {
  const main = async () => {
    // setTimeout(async () => {}, 1000)
    const indexHtmlUrl = new URL('../dist/index.html', import.meta.url)
    const dbUrl = new URL('../public/app-123.db', import.meta.url)
    console.log(await runSSR({ dbUrl, indexHtmlUrl }))
  }

  main()
}
