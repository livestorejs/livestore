import { liveStoreVersion } from '@livestore/livestore'
import { type Component, onMount } from 'solid-js'

export const VersionBadge: Component = () => {
  onMount(() => {
    console.log(`LiveStore v${liveStoreVersion}`)
  })

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        background: 'rgba(0, 0, 0, 0.8)',
        'border-radius': '4px',
        padding: '4px 8px',
        'font-size': '11px',
        'font-family':
          'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        color: 'white',
        'z-index': '1000',
        'user-select': 'none',
      }}
    >
      v{liveStoreVersion}
    </div>
  )
}
