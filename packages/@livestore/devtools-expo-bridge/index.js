// export let useVanillaLogViewer

import { useDevToolsPluginClient } from 'expo/devtools'
import { useEffect } from 'react'

// if (process.env.NODE_ENV === 'development') {
const originalConsoleLog = console.log
const originalConsoleWarn = console.warn
const originalConsoleError = console.error

export const useVanillaLogViewer = () => {
  const client = useDevToolsPluginClient('vanilla-log-viewer')
  useEffect(() => {
    const setup = () => {
      console.log = (...args) => {
        const payload = args.length === 1 ? args[0] : JSON.stringify(args)
        client?.sendMessage('log', payload)
        originalConsoleLog.apply(console, arguments)
      }
      console.warn = (...args) => {
        const payload = args.length === 1 ? args[0] : JSON.stringify(args)
        client?.sendMessage('warn', payload)
        originalConsoleWarn.apply(console, arguments)
      }
      console.error = (...args) => {
        const payload = args.length === 1 ? args[0] : JSON.stringify(args)
        client?.sendMessage('error', payload)
        originalConsoleError.apply(console, arguments)
      }
    }
    const teardown = () => {
      console.log = originalConsoleLog
      console.warn = originalConsoleWarn
      console.error = originalConsoleError
    }
    setup()
    return () => {
      teardown()
    }
  }, [client])
}
// } else {
//   useVanillaLogViewer = () => {
//     // noop
//   }
// }
