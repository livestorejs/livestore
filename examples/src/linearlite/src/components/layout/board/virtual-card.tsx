import { Card } from '@/components/layout/board/card'
import { tables } from '@/lib/livestore/schema'
import { useRow } from '@livestore/react'
import React, { memo } from 'react'
import { areEqual } from 'react-window'

export const VirtualCard = memo(({ issueId }: { issueId: number }) => {
  const [issue] = useRow(tables.issue, issueId)

  return <Card key={`issue-${issue.id}`} issue={issue} />
}, areEqual)
