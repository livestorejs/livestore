import { createFileRoute } from '@tanstack/react-router'

import { List } from '@/components/layout/list'

export const Route = createFileRoute('/')({
  component: List,
})
