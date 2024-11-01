import React from 'react'

export const originalStackLimit = Error.stackTraceLimit

export type StackInfo = {
  frames: StackFrame[]
}

export type StackFrame = {
  name: string
  filePath: string
}

/*
Example stack trace:

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
  
Approach:
  - Start filtering at `at useQuery` (including)
  - Stop filtering at `at renderWithHooks` (excluding)
 */
export const extractStackInfoFromStackTrace = (stackTrace: string): StackInfo => {
  const namePattern = /at (\S+) \((.+)\)/g
  let match: RegExpExecArray | null
  const frames: StackFrame[] = []
  let hasReachedStart = false

  while ((match = namePattern.exec(stackTrace)) !== null) {
    const [, name, filePath] = match as any as [string, string, string]

    // NOTE No idea where this `Module.` comes from - possibly a Vite thing?
    if ((name.startsWith('use') || name.startsWith('Module.use')) && name.endsWith('QueryRef') === false) {
      hasReachedStart = true

      frames.unshift({ name: name.replace(/^Module\./, ''), filePath })
    } else if (hasReachedStart) {
      // We've reached the end of the `use*` functions, so we're adding the component name and stop
      frames.unshift({ name, filePath })
      break
    }
  }

  return { frames }
}

export const useStackInfo = (): StackInfo =>
  React.useMemo(() => {
    Error.stackTraceLimit = 10
    // eslint-disable-next-line unicorn/error-message
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return extractStackInfoFromStackTrace(stack)
  }, [])

export const stackInfoToString = (stackInfo: StackInfo): string =>
  stackInfo.frames.map((f) => `${f.name} (${f.filePath})`).join('\n')
