import { Window } from 'happy-dom'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { GlobalRegistrator } from '@happy-dom/global-registrator';


// import { App } from './Root.jsx'

export const doSSR = async (): Promise<string> => {
  // const app = renderToString(<App ready={() => {}} />)

	const url = 'http://localhost:60002'

  // const window = new Window({
  //   innerWidth: 1024,
  //   innerHeight: 768,
  //   url,
  // })

  GlobalRegistrator.register({ url, width: 1920, height: 1080 })

  const document = window.document

	const viteScript = document.createElement('script')
	viteScript.type = 'module'
	viteScript.innerHTML = `
import RefreshRuntime from "/@react-refresh"
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__vite_plugin_react_preamble_installed__ = true
	`
	document.head.appendChild(viteScript)

	const viteClientScript = document.createElement('script')
	viteClientScript.type = 'module'
	viteClientScript.src = '/@vite/client'
	document.head.appendChild(viteClientScript)


  document.body.innerHTML = `
	
  		<div id="react-app"></div>
  		<script type="module" src="/src/main.tsx"></script>
  `

  document.title = 'Yolo page'

  // console.log('window.happyDOM', window.happyDOM)

  // Waits for async operations such as timers, resource loading and fetch() on the page to complete
  // Note that this may get stuck when using intervals or a timer in a loop (see IBrowserSettings for ways to mitigate this)
	// @ts-expect-error TODO
  await window.happyDOM.waitUntilComplete()

  // Outputs the rendered result
  // console.log(window.document.documentElement.outerHTML);

  // Cancels all ongoing operations and destroys the Window instance
  // await window.happyDOM.close()

  console.log('document.innerHTML', document.body.innerHTML)

  return `<!DOCTYPE html>
${window.document.documentElement.getHTML()}
  `
}

console.log(await doSSR())
