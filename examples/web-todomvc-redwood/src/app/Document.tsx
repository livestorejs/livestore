import type React from 'react'
import type { RequestInfo } from 'rwsdk/worker'

type DocumentProps = React.PropsWithChildren<RequestInfo>

export const Document: React.FC<DocumentProps> = ({ children, rw }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>LiveStore TodoMVC • RedwoodSDK</title>
      <link rel="modulepreload" href="/src/client.tsx" />
    </head>
    <body>
      {/* biome-ignore lint/correctness/useUniqueElementIds: Redwood hydrates client markup at a fixed root id */}
      <div id="root">{children}</div>
      {[...rw.entryScripts].map((src) => (
        <script key={src} type="module" src={src} nonce={rw.nonce} />
      ))}
      {[...rw.inlineScripts].map((content) => (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is generated server-side and protected by the request nonce.
        <script key={content} nonce={rw.nonce} dangerouslySetInnerHTML={{ __html: content }} />
      ))}
      <script type="module" nonce={rw.nonce}>
        import('/src/client.tsx')
      </script>
    </body>
  </html>
)
