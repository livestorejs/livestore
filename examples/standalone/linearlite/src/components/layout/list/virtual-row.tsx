import { Row } from '@/components/layout/list/row'
import { tables } from '@/lib/livestore/schema'
import { useQuery } from '@livestore/react'
import { queryDb } from '@livestore/livestore'
import React, { memo, type CSSProperties } from 'react'
import { areEqual } from 'react-window'

export const VirtualRow = memo(
  ({ data, index, style }: { data: readonly number[]; index: number; style: CSSProperties }) => {
    const issue = useQuery(queryDb(tables.issue.query.where({ id: data[index]! }).first(), { deps: [data[index]] }))
    return <Row key={`issue-${issue.id}`} issue={issue} style={style} />
  },
  areEqual,
)
