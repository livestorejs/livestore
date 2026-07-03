import { queryDb, Schema } from '@livestore/livestore'

import { tables } from '../schema.ts'
import type { DemoStore } from './DemoFrame.tsx'

const materializedClientDocumentRows$ = queryDb(
  {
    query: `SELECT * FROM threadListUi ORDER BY id`,
    bindValues: [],
    schema: Schema.Array(tables.threadListUi.rowSchema),
  },
  { label: 'materialized-client-document-rows' },
)

export const EventLogPanel = ({ store }: { store: DemoStore }) => {
  const rows = store.useQuery(materializedClientDocumentRows$)

  return (
    <section className="card">
      <h3>Initialization event effects</h3>
      <p>Each row below was materialized by the client-document generated setter event.</p>
      <pre>{JSON.stringify(rows, null, 2)}</pre>
    </section>
  )
}
