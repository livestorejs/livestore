import { useRouter } from '@tanstack/react-router'
import React from 'react'

import { NewIssueModalContext } from '../../app/contexts.ts'
import { useAppStore } from '../../livestore/store.ts'

export const KeyboardShortcuts = () => {
  const store = useAppStore()
  const router = useRouter()
  const { setNewIssueModalStatus } = React.useContext(NewIssueModalContext)!

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement
      if (element.classList.contains('input')) return

      if (e.key === 'c') {
        setNewIssueModalStatus(0)
        e.preventDefault()
      }

      // We use '?' instead of '/' because Shift+/ is '?'
      if (e.key === '?' && e.shiftKey) {
        router.navigate({ to: '/$storeId/search', params: { storeId: store.storeId } })
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [router, store.storeId, setNewIssueModalStatus])

  return null
}
