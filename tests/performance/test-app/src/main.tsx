import { makeAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { queryDb, SessionIdSymbol } from '@livestore/livestore'
import { LiveStoreProvider, useQuery, useStore } from '@livestore/react'
import React, { StrictMode } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'

import LiveStoreWorker from './livestore.worker.ts?worker'
import { type Items, type Item, schema, tables } from './schema.ts'

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

const adapter = makeAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

const RemoveIcon = <span>X</span>

const Row = React.memo(({ item }: { item: Item }) => {
  const { store } = useStore()
  const { selected } = useQuery(queryDb(tables.app.query.row(SessionIdSymbol)))
  const isSelected = selected === item.id
  return (
    <tr style={{ backgroundColor: isSelected ? 'lightblue' : 'white' }}>
      <td>{item.id}</td>
      <td>
        <Button
          id={`select-${item.id}`}
          onClick={() => {
            // @ts-expect-error `id` is not typed correctly
            store.mutate(tables.app.update({ where: { id: SessionIdSymbol }, values: { selected: item.id } }))
          }}
        >
          {item.label}
        </Button>
      </td>
      <td>
        <Button
          id={`remove-${item.id}`}
          onClick={() => {
            store.mutate(tables.items.delete({ where: { id: item.id } }))
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
  const items = useQuery(queryDb(tables.items.query.select()))
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
              store.mutate(
                tables.items.delete({ where: {} }),
                ...buildItems(1000).map((item) => tables.items.insert(item)),
              ) // Should replace the entire table
            }}
          >
            Create 1,000 rows
          </Button>
          <Button
            id="create10k"
            onClick={() => {
              store.mutate(...buildItems(10_000).map((item) => tables.items.insert(item)))
            }}
          >
            Create 10,000 rows
          </Button>
          <Button
            id="append1k"
            onClick={() => {
              store.mutate(...buildItems(1000).map((item) => tables.items.insert(item)))
            }}
          >
            Append 1,000 rows
          </Button>
          <Button
            id="updateEvery10th"
            onClick={() => {
              const items = store.query(queryDb(tables.items.query.select()))

              const updates = []
              for (let i = 0; i < items.length; i += 10) {
                updates.push(
                  tables.items.update({ where: { id: items[i]!.id }, values: { label: items[i]!.label + ' !!!' } }),
                )
              }

              store.mutate(...updates)
            }}
          >
            Update every 10th row
          </Button>
          <Button
            id="clear"
            onClick={() => {
              store.mutate(tables.items.delete({ where: {} }))
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
