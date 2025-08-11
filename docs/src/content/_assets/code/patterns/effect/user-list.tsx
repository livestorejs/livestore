// @ts-ignore - package will be installed by user
// @ts-ignore - package will be installed by user
import { Result, useAtomValue } from '@effect-atom/atom-react'
import { activeUsersAtom } from './queries.ts'

function _UserList() {
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
    .onError((error) => <div>Error: {error.message}</div>)
    .render()
}
