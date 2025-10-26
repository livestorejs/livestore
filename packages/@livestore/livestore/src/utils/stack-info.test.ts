import { expect, it } from 'vitest'

import { extractStackInfoFromStackTrace } from './stack-info.ts'

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

  const stackInfo = extractStackInfoFromStackTrace(stackTrace)
  // Replacing file paths for snapshot testing as they are not stable
  stackInfo.frames.forEach((_) => {
    _.filePath = '__REPLACED_FOR_SNAPSHOT__'
  })
  expect(stackInfo).toMatchInlineSnapshot(`
    {
      "frames": [
        {
          "filePath": "__REPLACED_FOR_SNAPSHOT__",
          "name": "RouteLink",
        },
        {
          "filePath": "__REPLACED_FOR_SNAPSHOT__",
          "name": "useRoute",
        },
        {
          "filePath": "__REPLACED_FOR_SNAPSHOT__",
          "name": "useAppState",
        },
        {
          "filePath": "__REPLACED_FOR_SNAPSHOT__",
          "name": "useQuery",
        },
      ],
    }
  `)
})

it('Tracklist_ stacktrace', async () => {
  const stackTrace = `\
Error
    at https://localhost:8081/@fs/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/livestore/dist/react/useQuery.js?t=1701368568351:19:23
    at mountMemo (https://localhost:8081/node_modules/.vite-web/deps/chunk-YKTDXTVC.js?v=86daed82:12817:27)
    at Object.useMemo (https://localhost:8081/node_modules/.vite-web/deps/chunk-YKTDXTVC.js?v=86daed82:13141:24)
    at Object.useMemo (https://localhost:8081/node_modules/.vite-web/deps/chunk-7P4K3U7O.js?v=86daed82:1094:29)
    at useQueryRef (https://localhost:8081/@fs/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/livestore/dist/react/useQuery.js?t=1701368568351:16:29)
    at Module.useQuery (https://localhost:8081/@fs/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/livestore/dist/react/useQuery.js?t=1701368568351:13:36)
    at Tracklist_ (https://localhost:8081/src/components/Tracklist/Tracklist.tsx?t=1701368568351:148:44)
    at renderWithHooks (https://localhost:8081/node_modules/.vite-web/deps/chunk-YKTDXTVC.js?v=86daed82:12171:26)
    at mountIndeterminateComponent (https://localhost:8081/node_modules/.vite-web/deps/chunk-YKTDXTVC.js?v=86daed82:14921:21)
    at beginWork (https://localhost:8081/node_modules/.vite-web/deps/chunk-YKTDXTVC.js?v=86daed82:15902:22)
`

  const stackInfo = extractStackInfoFromStackTrace(stackTrace)
  // Replacing file paths for snapshot testing as they are not stable
  stackInfo.frames.forEach((_) => {
    _.filePath = '__REPLACED_FOR_SNAPSHOT__'
  })
  expect(stackInfo).toMatchInlineSnapshot(`
    {
      "frames": [
        {
          "filePath": "__REPLACED_FOR_SNAPSHOT__",
          "name": "Tracklist_",
        },
        {
          "filePath": "__REPLACED_FOR_SNAPSHOT__",
          "name": "useQuery",
        },
      ],
    }
  `)
})

it('React 19', async () => {
  const stackTrace = `\
Error: 
    at /Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/react/src/useQuery.ts:57:19
    at mountMemo (/Users/schickling/Code/overtone/node_modules/.pnpm/react-dom@19.0.0_react@19.0.0/node_modules/react-dom/cjs/react-dom-client.development.js:6816:23)
    at Object.useMemo (/Users/schickling/Code/overtone/node_modules/.pnpm/react-dom@19.0.0_react@19.0.0/node_modules/react-dom/cjs/react-dom-client.development.js:22757:18)
    at Object.process.env.NODE_ENV.exports.useMemo (/Users/schickling/Code/overtone/node_modules/.pnpm/react@19.0.0/node_modules/react/cjs/react.development.js:1488:34)
    at Module.useQueryRef (/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/react/src/useQuery.ts:54:27)
    at Module.useClientDocument (/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/react/src/useClientDocument.ts:111:20)
    at TestComponent (/Users/schickling/Code/overtone/node_modules/.pnpm/@testing-library+react@16.1.0_@testing-library+dom@10.4.0_@types+react-dom@19.0.3_@types+reac_2jaiibiag2sxou3wtzbuqx3r5a/node_modules/@testing-library/react/dist/pure.js:309:27)
    at Object.react-stack-bottom-frame (/Users/schickling/Code/overtone/node_modules/.pnpm/react-dom@19.0.0_react@19.0.0/node_modules/react-dom/cjs/react-dom-client.development.js:22428:20)
    at renderWithHooks (/Users/schickling/Code/overtone/node_modules/.pnpm/react-dom@19.0.0_react@19.0.0/node_modules/react-dom/cjs/react-dom-client.development.js:5757:22)
  `

  const stackInfo = extractStackInfoFromStackTrace(stackTrace)
  expect(stackInfo).toMatchInlineSnapshot(`
    {
      "frames": [
        {
          "filePath": "/Users/schickling/Code/overtone/node_modules/.pnpm/@testing-library+react@16.1.0_@testing-library+dom@10.4.0_@types+react-dom@19.0.3_@types+reac_2jaiibiag2sxou3wtzbuqx3r5a/node_modules/@testing-library/react/dist/pure.js:309:27",
          "name": "TestComponent",
        },
        {
          "filePath": "/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/react/src/useClientDocument.ts:111:20",
          "name": "useClientDocument",
        },
      ],
    }
  `)
})

it('React 19 - skip react-stack-bottom-frame', async () => {
  const stackTrace = `\
Error: 
    at /Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/react/src/useQuery.ts:57:19
    at mountMemo (/Users/schickling/Code/overtone/node_modules/.pnpm/react-dom@19.0.0_react@19.0.0/node_modules/react-dom/cjs/react-dom-client.development.js:6816:23)
    at Object.useMemo (/Users/schickling/Code/overtone/node_modules/.pnpm/react-dom@19.0.0_react@19.0.0/node_modules/react-dom/cjs/react-dom-client.development.js:22757:18)
    at Object.process.env.NODE_ENV.exports.useMemo (/Users/schickling/Code/overtone/node_modules/.pnpm/react@19.0.0/node_modules/react/cjs/react.development.js:1488:34)
    at Module.useQueryRef (/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/react/src/useQuery.ts:54:27)
    at Module.useClientDocument (/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/react/src/useClientDocument.ts:111:20)
    at Object.react-stack-bottom-frame (/Users/schickling/Code/overtone/node_modules/.pnpm/react-dom@19.0.0_react@19.0.0/node_modules/react-dom/cjs/react-dom-client.development.js:22428:20)
    at renderWithHooks (/Users/schickling/Code/overtone/node_modules/.pnpm/react-dom@19.0.0_react@19.0.0/node_modules/react-dom/cjs/react-dom-client.development.js:5757:22)
  `

  const stackInfo = extractStackInfoFromStackTrace(stackTrace)
  expect(stackInfo).toMatchInlineSnapshot(`
    {
      "frames": [
        {
          "filePath": "/Users/schickling/Code/overtone/submodules/livestore/packages/@livestore/react/src/useClientDocument.ts:111:20",
          "name": "useClientDocument",
        },
      ],
    }
  `)
})
