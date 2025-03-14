import { makeAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import { queryDb, SessionIdSymbol } from '@livestore/livestore'
import { LiveStoreProvider, useQuery, useStore } from '@livestore/react'
import React, { StrictMode } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { createRoot } from 'react-dom/client'

import LiveStoreWorker from './livestore.worker.ts?worker'
import { type Data, schema, tables } from './schema.ts'

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
const buildData = (count: number): Data => {
  const data: Data = Array.from({ length: count })
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: nextId++,
      label: `${A[random(A.length)]} ${C[random(C.length)]} ${N[random(N.length)]}`,
    }
  }
  return data
}

const adapter = makeAdapter({
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
  storage: { type: 'opfs' },
})

const GlyphIcon = (
  <span className="glyphicon glyphicon-remove" aria-hidden="true">
    X
  </span>
)

const Row = React.memo(({ data }: { data: { id: number; label: string } }) => {
  const { store } = useStore()
  const { selected } = useQuery(queryDb(tables.app.query.row(SessionIdSymbol)))
  const isSelected = selected === data.id
  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td className="col-md-1">{data.id}</td>
      <td className="col-md-4">
        <a
          onClick={() => {
            performance.mark('select-row:start')
            // @ts-expect-error `id` is not typed correctly
            store.mutate(tables.app.update({ where: { id: SessionIdSymbol }, values: { selected: data.id } }))
            performance.mark('select-row:end')
          }}
        >
          {data.label}
        </a>
      </td>
      <td className="col-md-1">
        <a
          onClick={() => {
            performance.mark('remove-row:start')
            store.mutate(tables.data.delete({ where: { id: data.id } }))
            performance.mark('remove-row:end')
          }}
        >
          {GlyphIcon}
        </a>
      </td>
      <td className="col-md-6"></td>
    </tr>
  )
})

const RowList = React.memo(() => {
  const rows = useQuery(queryDb(tables.data.query.select()))
  return rows.map((data) => <Row key={data.id} data={data} />)
})

const Button = React.memo(({ id, title, cb }: { id: string; title: string; cb: () => void }) => (
  <div className="col-sm-6 smallpad">
    <button type="button" className="btn btn-primary btn-block" id={id} onClick={cb}>
      {title}
    </button>
  </div>
))

const Main = () => {
  const { store } = useStore()
  return (
    <div className="container">
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React + LiveStore</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <Button
                id="run"
                title="Create 1,000 rows"
                cb={() => {
                  performance.mark("run:start")
                  store.mutate(
                    tables.data.delete({ where: {} }),
                    ...buildData(1000).map((row) => tables.data.insert(row)),
                  ) // Should replace the entire table
                  performance.mark('run:end')
                }}
              />
              <Button
                id="runlots"
                title="Create 10,000 rows"
                cb={() => {
                  performance.mark("runlots:start")
                  store.mutate(...buildData(10_000).map((row) => tables.data.insert(row)))
                  performance.mark('runlots:end')
                }}
              />
              <Button
                id="add"
                title="Append 1,000 rows"
                cb={() => {
                  performance.mark("add:start")
                  store.mutate(...buildData(1000).map((row) => tables.data.insert(row)))
                  performance.mark('add:end')
                }}
              />
              <Button
                id="update"
                title="Update every 10th row"
                cb={() => {
                  performance.mark("update:start")
                  const rows = store.query(queryDb(tables.data.query.select()))

                  const updates = []
                  for (let i = 0; i < rows.length; i += 10) {
                    updates.push(
                      tables.data.update({ where: { id: rows[i]!.id }, values: { label: rows[i]!.label + ' !!!' } }),
                    )
                  }

                  store.mutate(...updates)
                  performance.mark('update:end')
                }}
              />
              <Button
                id="clear"
                title="Clear"
                cb={() => {
                  performance.mark("clear:start")
                  store.mutate(tables.data.delete({ where: {} }))
                  performance.mark('clear:end')
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <table className="table table-hover table-striped test-data">
        <tbody>
          <RowList />
        </tbody>
      </table>
      <span className="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
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
