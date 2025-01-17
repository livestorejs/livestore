import { Row } from '@/components/layout/list/row'
import { tables } from '@/lib/livestore/schema'
import { useRow } from '@livestore/react'
import React, { memo, type CSSProperties } from 'react'
import { areEqual } from 'react-window'

export const VirtualRow = memo(
  ({ data, index, style }: { data: readonly string[]; index: number; style: CSSProperties }) => {
    const [issue] = useRow(tables.issue, data[index]!)

    return <Row key={`issue-${issue.id}`} issue={issue} style={style} />
  },
  areEqual,
)
