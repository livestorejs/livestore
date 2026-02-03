import { liveStoreVersion } from '@livestore/livestore'
import { useEffect } from 'react'

export const VersionBadge = () => {
  useEffect(() => {
    console.log(`LiveStore v${liveStoreVersion}`)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        background: 'rgba(0, 0, 0, 0.8)',
        borderRadius: '4px',
        padding: '4px 8px',
        fontSize: '11px',
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        color: 'white',
        zIndex: 1000,
        userSelect: 'none',
      }}
    >
      v{liveStoreVersion}
    </div>
  )
}
