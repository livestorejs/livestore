/** biome-ignore-all lint/nursery: testing */
/** biome-ignore-all lint/correctness/useUniqueElementIds: it's ok for testing */
import { StoreRegistry } from '@livestore/livestore'
import { StoreRegistryProvider } from '@livestore/react'
import React, { StrictMode, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { allItems$, uiState$ } from './queries.ts'
import { events, type Item, type Items } from './schema.ts'
import { useAppStore } from './store.ts'

const A = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
]
const C = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange']
const N = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
]

const random = (max: number) => Math.round(Math.random() * 1000) % max

const selectedRowStyle = { backgroundColor: 'lightblue' } as const
const defaultRowStyle = { backgroundColor: 'white' } as const
const suspenseFallback = <p>Loading...</p>

let nextId = 1
const generateRandomItems = (count: number): Items => {
  const items: Items = Array.from({ length: count })
  for (let i = 0; i < count; i++) {
    items[i] = {
      id: nextId++,
      label: `${A[random(A.length)]} ${C[random(C.length)]} ${N[random(N.length)]}`,
    }
  }
  return items
}

const RemoveIcon = <span>X</span>

const ItemRow = React.memo(({ item }: { item: Item }) => {
  const store = useAppStore()
  const { selected } = store.useQuery(uiState$)
  const isSelected = selected === item.id
  const rowStyle = isSelected ? selectedRowStyle : defaultRowStyle
  const handleSelect = React.useCallback(() => {
    store.commit(events.uiStateSet({ selected: item.id }))
  }, [store, item.id])
  const handleRemove = React.useCallback(() => {
    store.commit(events.itemDeleted({ id: item.id }))
  }, [store, item.id])

  return (
    <tr style={rowStyle}>
      <td>{item.id}</td>
      <td>
        <Button id={`select-${item.id}`} onClick={handleSelect}>
          {item.label}
        </Button>
      </td>
      <td>
        <Button id={`remove-${item.id}`} onClick={handleRemove}>
          {RemoveIcon}
        </Button>
      </td>
      <td />
    </tr>
  )
})

const ItemRowList = React.memo(() => {
  const store = useAppStore()
  const items = store.useQuery(allItems$)
  return items.map((item) => <ItemRow key={item.id} item={item} />)
})

const Button = React.memo(
  ({ id, onClick, children }: { id: string; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" id={id} onClick={onClick}>
      {children}
    </button>
  ),
)

const Main = () => {
  const store = useAppStore()

  const handleCreate1k = React.useCallback(() => {
    // We commit a single event instead of one per item to better represent user intention. The user didn't press a button 1000 times for each item; they pressed it once to create 1000 items.
    // We need to include the items in the event payload rather than generating them in the materializer. Otherwise, the materializer wouldn't be deterministic.
    store.commit(events.thousandItemsCreated(generateRandomItems(1000)))
  }, [store])
  const handleCreate10k = React.useCallback(() => {
    store.commit(events.tenThousandItemsCreated(generateRandomItems(10_000)))
  }, [store])
  const handleAppend1k = React.useCallback(() => {
    store.commit(events.thousandItemsAppended(generateRandomItems(1000)))
  }, [store])
  const handleUpdateEvery10th = React.useCallback(() => {
    store.commit(events.everyTenthItemUpdated())
  }, [store])
  const handleClear = React.useCallback(() => {
    store.commit(events.allItemsDeleted())
  }, [store])

  return (
    <div>
      <div>
        <h1>React + LiveStore</h1>
        <div>
          <Button id="create1k" onClick={handleCreate1k}>
            Create 1,000 items
          </Button>
          <Button id="create10k" onClick={handleCreate10k}>
            Create 10,000 items
          </Button>
          <Button id="append1k" onClick={handleAppend1k}>
            Append 1,000 items
          </Button>
          <Button id="updateEvery10th" onClick={handleUpdateEvery10th}>
            Update every 10th items
          </Button>
          <Button id="clear" onClick={handleClear}>
            Clear
          </Button>
        </div>
      </div>
      <table>
        <tbody>
          <ItemRowList />
        </tbody>
      </table>
    </div>
  )
}

const App = () => {
  const [storeRegistry] = useState(() => new StoreRegistry())

  return (
    <Suspense fallback={suspenseFallback}>
      <StoreRegistryProvider storeRegistry={storeRegistry}>
        <Main />
      </StoreRegistryProvider>
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
