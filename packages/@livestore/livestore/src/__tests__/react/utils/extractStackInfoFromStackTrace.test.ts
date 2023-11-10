import { expect, it } from 'vitest'

import { extractStackInfoFromStackTrace } from '../../../react/utils/extractStackInfoFromStackTrace.js'

it('RouteLink stacktrace', async () => {
  const stackTrace = `\
Error
	at https://localhost:8081/@fs/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/livestore/dist/react/useQuery.js?t=1699550216884:18:23
	at mountMemo (https://localhost:8081/node_modules/.vite-web/deps/chunk-M23HUTQV.js?v=3eb66ed6:12817:27)
	at Object.useMemo (https://localhost:8081/node_modules/.vite-web/deps/chunk-M23HUTQV.js?v=3eb66ed6:13141:24)
	at Object.useMemo (https://localhost:8081/node_modules/.vite-web/deps/chunk-4WADDZ2G.js?v=3eb66ed6:1094:29)
	at useQuery (https://localhost:8081/@fs/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/livestore/dist/react/useQuery.js?t=1699550216884:13:33)
	at useAppState (https://localhost:8081/src/db/AppState.ts?t=1699550216884:17:34)
	at useRoute (https://localhost:8081/src/db/AppState.ts?t=1699550216884:74:22)
	at RouteLink (https://localhost:8081/src/components/Link.tsx?t=1699550216884:36:7)
	at renderWithHooks (https://localhost:8081/node_modules/.vite-web/deps/chunk-M23HUTQV.js?v=3eb66ed6:12171:26)
	at mountIndeterminateComponent (https://localhost:8081/node_modules/.vite-web/deps/chunk-M23HUTQV.js?v=3eb66ed6:14921:21)
`

  expect(extractStackInfoFromStackTrace(stackTrace)).toMatchInlineSnapshot(`
    [
      {
        "filePath": "https://localhost:8081/src/components/Link.tsx?t=1699550216884:36:7",
        "name": "RouteLink",
      },
      {
        "filePath": "https://localhost:8081/src/db/AppState.ts?t=1699550216884:74:22",
        "name": "useRoute",
      },
      {
        "filePath": "https://localhost:8081/src/db/AppState.ts?t=1699550216884:17:34",
        "name": "useAppState",
      },
      {
        "filePath": "https://localhost:8081/@fs/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/livestore/dist/react/useQuery.js?t=1699550216884:13:33",
        "name": "useQuery",
      },
    ]
  `)
})
