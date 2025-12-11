import { queryDb } from '@livestore/livestore'
import { type CSSProperties, memo } from 'react'
import { areEqual } from 'react-window'
import { tables } from '../../../livestore/schema/index.ts'
import { useAppStore } from '../../../livestore/store.ts'
import { Row } from './row.tsx'

export const VirtualRow = memo(
  ({ data, index, style }: { data: readonly number[]; index: number; style: CSSProperties }) => {
    const store = useAppStore()
    const issue = store.useQuery(
      queryDb(tables.issue.where({ id: data[index]! }).first({ behaviour: 'error' }), { deps: [data[index]] }),
    )
    return <Row key={`issue-${issue.id}`} issue={issue} style={style} />
  },
  areEqual,
)
