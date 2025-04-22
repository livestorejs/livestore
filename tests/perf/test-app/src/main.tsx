import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { LiveStoreProvider, useQuery, useStore } from '@livestore/react'
import React, { StrictMode } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'

import LiveStoreWorker from './livestore.worker.js?worker'
import { allItems$, uiState$ } from './queries.js'
import { events, type Item, type Items, schema } from './schema.js'

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

let nextId = 1
const buildItems = (count: number): Items => {
  const items: Items = Array.from({ length: count })
  for (let i = 0; i < count; i++) {
    items[i] = {
      id: nextId++,
      label: `${A[random(A.length)]} ${C[random(C.length)]} ${N[random(N.length)]}`,
    }
  }
  return items
}

const adapter = makePersistedAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

const RemoveIcon = <span>X</span>

const Row = React.memo(({ item }: { item: Item }) => {
  const { store } = useStore()
  const { selected } = useQuery(uiState$)
  const isSelected = selected === item.id
  return (
    <tr style={{ backgroundColor: isSelected ? 'lightblue' : 'white' }}>
      <td>{item.id}</td>
      <td>
        <Button
          id={`select-${item.id}`}
          onClick={() => {
            store.commit(events.uiStateSet({ selected: item.id }))
          }}
        >
          {item.label}
        </Button>
      </td>
      <td>
        <Button
          id={`remove-${item.id}`}
          onClick={() => {
            store.commit(events.itemDeleted({ id: item.id }))
          }}
        >
          {RemoveIcon}
        </Button>
      </td>
      <td></td>
    </tr>
  )
})

const RowList = React.memo(() => {
  const items = useQuery(allItems$)
  return items.map((item) => <Row key={item.id} item={item} />)
})

const Button = React.memo(
  ({ id, onClick, children }: { id: string; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" id={id} onClick={onClick}>
      {children}
    </button>
  ),
)

const Main = () => {
  const { store } = useStore()
  return (
    <div>
      <div>
        <h1>React + LiveStore</h1>
        <div>
          <Button
            id="create1k"
            onClick={() => {
              store.commit(events.thousandItemsCreated(buildItems(1000)))
            }}
          >
            Create 1,000 rows
          </Button>
          <Button
            id="create10k"
            onClick={() => {
              store.commit(events.tenThousandItemsCreated(buildItems(10_000)))
            }}
          >
            Create 10,000 rows
          </Button>
          <Button
            id="append1k"
            onClick={() => {
              store.commit(events.thousandItemsAppended(buildItems(1000)))
            }}
          >
            Append 1,000 rows
          </Button>
          <Button
            id="updateEvery10th"
            onClick={() => {
              store.commit(events.everyTenthItemUpdated())
            }}
          >
            Update every 10th row
          </Button>
          <Button
            id="clear"
            onClick={() => {
              store.commit(events.allItemsDeleted())
            }}
          >
            Clear
          </Button>
        </div>
      </div>
      <table>
        <tbody>
          <RowList />
        </tbody>
      </table>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      batchUpdates={batchUpdates}
      renderLoading={(bootStatus) => <p>Stage: {bootStatus.stage}</p>}
    >
      <Main />
    </LiveStoreProvider>
  </StrictMode>,
)
