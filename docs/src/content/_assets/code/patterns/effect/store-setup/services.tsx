import { useAtomSet } from '@effect-atom/atom-react'
import { Context, Effect } from 'effect'
import { StoreTag } from './atoms.ts'
import { events } from './schema.ts'

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

// Simple commit example
export const createItemAtom = StoreTag.runtime.fn<string>()((itemName, get) => {
  return Effect.sync(() => {
    const store = get(StoreTag.storeUnsafe)
    if (store) {
      store.commit(
        events.itemCreated({
          id: crypto.randomUUID(),
          name: itemName,
          metadata: { createdAt: new Date().toISOString() },
        }),
      )
    }
  })
})

// Use in a React component
export function CreateItemButton() {
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
