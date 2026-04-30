import { createFileRoute } from '@tanstack/react-router'

import { List } from '../../components/layout/list/index.tsx'

export const Route = createFileRoute('/$storeId/')({
  component: List,
})
