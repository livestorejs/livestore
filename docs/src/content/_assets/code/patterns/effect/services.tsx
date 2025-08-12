import React from 'react'
import { useAtomSet } from '@effect-atom/atom-react'
import { Context, Effect } from 'effect'

// These would normally be imported from './atoms.ts' and './schema.ts'
declare const StoreTag: {
  runtime: {
    fn: <T>() => (fn: (arg: T, get: any) => any) => any
  }
  commit: any
  storeUnsafe: any
}

declare const events: {
  itemCreated: (payload: {
    id: string
    name: string
    metadata: Record<string, unknown>
  }) => any
}

// Example service definition
export class MyService extends Context.Tag('MyService')<
  MyService,
  {
    processItem: (name: string) => Effect.Effect<{
      name: string
      metadata: Record<string, unknown>
    }>
  }
>() {}

// Use the commit hook for event handling
export const useCommit = () => useAtomSet(StoreTag.commit)

// Create an atom that uses Effect services
export const createItemAtom = StoreTag.runtime.fn<string>()((itemName: string, get: any) => {
  return Effect.gen(function* () {
    // Access Effect services
    const service = yield* MyService

    // Perform service operations
    const processedData = yield* service.processItem(itemName)

    // Get the store and commit events
    const store = get(StoreTag.storeUnsafe)
    if (store) {
      store.commit(
        events.itemCreated({
          id: crypto.randomUUID(),
          name: processedData.name,
          metadata: processedData.metadata,
        }),
      )
    }
  }).pipe(Effect.tapErrorCause(Effect.log)) as any
})

// Use in a React component
function _CreateItemButton() {
  const createItem = useAtomSet(createItemAtom)

  const handleClick = () => {
    createItem('New Item')
  }

  return (
    <button type="button" onClick={handleClick}>
      Create Item
    </button>
  )
}