import { useNavigate } from '@tanstack/react-router'

import { nanoid } from '@livestore/livestore'

import { userEvents } from './user.schema.ts'
import { useCurrentUserStore } from './user.store.ts'

// Component for creating a new workspace
export function CreateWorkspace() {
  const userStore = useCurrentUserStore()
  const navigate = useNavigate()

  const createStore = (formData: FormData) => {
    const name = formData.get('name') as string
    if (!name.trim()) return

    const workspaceId = nanoid()

    userStore.commit(userEvents.workspaceCreated({ workspaceId, name }))

    navigate({ to: '/workspace/$workspaceId', params: { workspaceId } })
  }

  return (
    <form action={createStore}>
      <input type="text" name="name" placeholder="Workspace name" required />
      <button type="submit">Create Workspace</button>
    </form>
  )
}
