import { CodeBracketIcon } from '@heroicons/react/16/solid'
import { useStore } from '@livestore/react'
import React from 'react'

export const DevtoolsButton = ({ className }: { className?: string }) => {
  const { store } = useStore()
  const devtoolsUrl = React.useMemo(() => {
    // Respect Vite base + plugin mount path when available
    const basePath = (globalThis as { LIVESTORE_DEVTOOLS_PATH?: string }).LIVESTORE_DEVTOOLS_PATH ?? '/_livestore'
    const schemaAlias = store.schema.devtools.alias
    // Open DevTools directly connected to this store/session
    return `${location.origin}${basePath}/web/${store.storeId}/${store.clientId}/${store.sessionId}/${schemaAlias}`
  }, [store.storeId, store.sessionId, store.clientId, store.schema.devtools.alias])

  return (
    <div className={`lg:h-full flex items-center ${className}`}>
      <a
        aria-label="Download database"
        href={devtoolsUrl}
        target="_blank"
        className="h-6 px-1.5 flex items-center gap-1 bg-orange-500 text-white rounded hover:bg-orange-400 focus:outline-none focus:bg-orange-400"
      >
        <CodeBracketIcon className="size-3.5 shrink-0" />
        <span>Devtools</span>
      </a>
    </div>
  )
}
