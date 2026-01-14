import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { queryDb, StoreRegistry, storeOptions } from '@livestore/livestore'
import { StoreRegistryProvider, useStore } from '@livestore/react'
import { useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { schema, tables } from './issue.schema.ts'

const issueStoreOptions = (issueId: string) =>
  storeOptions({
    storeId: `issue-${issueId}`,
    schema,
    adapter: makeInMemoryAdapter(),
  })

export function App() {
  const [storeRegistry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))
  return (
    <StoreRegistryProvider storeRegistry={storeRegistry}>
      <IssueView />
    </StoreRegistryProvider>
  )
}

function IssueView() {
  const store = useStore(issueStoreOptions('abc123'))
  const [issue] = store.useQuery(queryDb(tables.issue.select()))
  return <div>{issue?.title}</div>
}
