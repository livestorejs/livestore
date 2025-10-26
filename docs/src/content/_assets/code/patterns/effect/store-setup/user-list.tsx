import { Result, useAtomValue } from '@effect-atom/atom-react'
import { activeUsersAtom } from './queries.ts'

export function UserList() {
  const users = useAtomValue(activeUsersAtom)

  return Result.builder(users)
    .onInitial(() => <div>Loading users...</div>)
    .onSuccess((users) => (
      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    ))
    .onDefect((error: any) => <div>Error: {error.message}</div>)
    .render()
}
