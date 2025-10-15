import type React from 'react'

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => (
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
      <script type="module">import("/src/client.tsx")</script>
    </body>
  </html>
)
