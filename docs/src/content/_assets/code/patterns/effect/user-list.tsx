import { Result, useAtomValue } from '@effect-atom/atom-react'
import { activeUsersAtom } from './queries.ts'

function _UserList() {
  const users = useAtomValue(activeUsersAtom)

  return (Result.builder(users) as any)
    .onInitial(() => <div>Loading users...</div>)
    .onSuccess((users: any) => (
      <ul>
        {users.map((user: any) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    ))
    .onError((error: any) => <div>Error: {error.message}</div>)
    .render()
}
