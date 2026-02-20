import { nanoid } from '@livestore/livestore'
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

import { userEvents } from './user.schema.ts'
import { useCurrentUserStore } from './user.store.ts'

// Component for creating a new workspace
export const CreateWorkspace = () => {
  const userStore = useCurrentUserStore()
  const navigate = useNavigate()

  const createStore = useCallback(
    (formData: FormData) => {
      const name = formData.get('name')
      if (typeof name !== 'string') return
      if (name.trim() === '') return

      const workspaceId = nanoid()

      userStore.commit(userEvents.workspaceCreated({ workspaceId, name }))

      navigate({ to: '/workspace/$workspaceId', params: { workspaceId } })
    },
    [navigate, userStore],
  )

  return (
    <form action={createStore}>
      <input type="text" name="name" placeholder="Workspace name" required />
      <button type="submit">Create Workspace</button>
    </form>
  )
}
