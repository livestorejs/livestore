import React from 'react'
import { Result, useAtomValue } from '@effect-atom/atom-react'

// This example assumes activeUsersAtom is imported from queries.ts
// which uses StoreTag.makeQuery to create a reactive query atom
declare const activeUsersAtom: any

function _UserList() {
  const users = useAtomValue(activeUsersAtom)

  return Result.builder(users)
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