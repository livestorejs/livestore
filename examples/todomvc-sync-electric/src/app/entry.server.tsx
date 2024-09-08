import type { EntryContext } from '@remix-run/node'
import { RemixServer } from '@remix-run/react'
import React from 'react'
import { renderToString } from 'react-dom/server'

const handleRequest = (
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) => {
  const shellHtml = `
		<!DOCTYPE html>
    <html>
      <head>
        <title>TodoMVC with ElectricSQL</title>
      </head>
      <body>
        <div id="root">__APP_HTML__</div>
      </body>
    </html>
  `

  const appHtml = renderToString(<RemixServer context={remixContext} url={request.url} />)

  const html = shellHtml.replace('__APP_HTML__', appHtml)

  responseHeaders.set('Content-Type', 'text/html')

  return new Response(html, {
    status: responseStatusCode,
    headers: responseHeaders,
  })
}

export default handleRequest
