import { tables } from '@/lib/livestore/schema'
import { useRow } from '@livestore/react'
import React, { memo, type CSSProperties } from 'react'
import { areEqual } from 'react-window'
import { Card } from './card'

export const VirtualCard = memo(
  ({ data, index, style }: { data: readonly string[]; index: number; style: CSSProperties }) => {
    const [issue] = useRow(tables.issue, data[index]!)

    return <Card key={`issue-${issue.id}`} issue={issue} style={style} />
  },
  areEqual,
)
