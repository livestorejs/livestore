import { useQuery } from '@livestore/react'
import { uiState$ } from '@/livestore/queries.ts'

export const useUser = (userId?: string) => {
  const ui = useQuery(uiState$)
  const defaultName = 'Anonymous Sloth'
  const name = (ui.currentUserName?.trim() ?? '') || defaultName
  const id =
    (userId ?? ui.currentUserId)?.trim() || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return { id, name }
}
