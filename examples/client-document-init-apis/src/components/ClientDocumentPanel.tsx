import { queryDb, Schema } from '@livestore/livestore'

import { tables } from '../schema.ts'
import type { DemoStore } from './DemoFrame.tsx'

const clientDocumentRow$ = (documentId: string) =>
  queryDb(
    {
      query: `SELECT * FROM threadListUi WHERE id = ?`,
      bindValues: [documentId],
      schema: Schema.Array(tables.threadListUi.rowSchema),
    },
    { deps: documentId, label: `threadListUi:${documentId}` },
  )

export const ClientDocumentPanel = ({ store, documentId }: { store: DemoStore; documentId: string }) => {
  const rows = store.useQuery(clientDocumentRow$(documentId))

  return (
    <section className="card">
      <h3>Client-document row</h3>
      <p>
        id: <span className="badge">{documentId}</span>
      </p>
      <pre>{JSON.stringify(rows[0] ?? null, null, 2)}</pre>
    </section>
  )
}
