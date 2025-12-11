import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { queryDb } from '@livestore/livestore'
import { StoreRegistry, StoreRegistryProvider, storeOptions, useStore } from '@livestore/react'
import { useState } from 'react'
import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
import { schema, tables } from './schema.ts'

const issueStoreOptions = (issueId: string) =>
  storeOptions({
    storeId: `issue-${issueId}`,
    schema,
    adapter: makeInMemoryAdapter(),
  })

export function App() {
  const [registry] = useState(() => new StoreRegistry({ defaultOptions: { batchUpdates } }))
  return (
    <StoreRegistryProvider storeRegistry={registry}>
      <IssueView />
    </StoreRegistryProvider>
  )
}

function IssueView() {
  const store = useStore(issueStoreOptions('abc123'))
  const [issue] = store.useQuery(queryDb(tables.issue.select()))
  return <div>{issue?.title}</div>
}
